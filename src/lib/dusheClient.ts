import type { ChannelId, PlayLine, VideoItem } from './types'
import { absolutePlayUrl, coverUrl, playProxy, upstreamFromPlay, vodUrl } from './mediaProxy'
import { sha1 } from './sha1'

const CHANNELS: { id: ChannelId; name: string; path: string }[] = [
  { id: 'movie', name: '电影', path: '/channel/1.html' },
  { id: 'tv', name: '连续剧', path: '/channel/2.html' },
  { id: 'anime', name: '动漫', path: '/channel/3.html' },
  { id: 'variety', name: '综艺纪录', path: '/channel/4.html' },
  { id: 'short', name: '短剧', path: '/channel/6.html' },
]
const CHANNEL_BY_NO: Record<string, ChannelId> = { 1: 'movie', 2: 'tv', 3: 'anime', 4: 'variety', 6: 'short' }
const TYPE_CHANNEL: Record<string, ChannelId> = {
  电影: 'movie',
  连续剧: 'tv',
  动漫: 'anime',
  综艺纪录: 'variety',
  短剧: 'short',
}
/** 首页栏目没链到频道时，按标题认是哪一类。先认短剧、动漫、综艺，免得“剧”字把它们都算成连续剧。 */
const SECTION_CHANNELS: [RegExp, ChannelId][] = [
  [/短剧/, 'short'],
  [/动漫|动画/, 'anime'],
  [/综艺|纪录/, 'variety'],
  [/剧/, 'tv'],
]
const PLAY_PATH = /^\/play\/\d+-\d+-\d+\.html$/
const TOKEN_KEY = 'video_website_search_token'
const LINE_HEALTH_KEY = 'video_website_line_health'
/** 线路能不能播记这么久，过了就重新按名字排。 */
const LINE_MEMORY = 6 * 60 * 60 * 1000
/** 开播时一起探的线路数。先探完能播的就用它，其余的立刻停掉。 */
const STARTERS = 4
/** 快速试探时，有一条线路下载比播放快这么多倍，就不再等别的线路。 */
const QUICK_ENOUGH = 2
/** 已经有一条能播的线路后，最多再等别的线路这么久。 */
const PROBE_GRACE = 2500
/** 一轮试探最长这么久，片库页面卡住不回时不至于一直等下去。 */
const PROBE_LIMIT = 20_000
/** 片库偶尔整站回 404、5xx 或 CDN 默认页，网络也会断一下，多半几秒就好。依次隔这么久再试。 */
const PAGE_RETRY = [1000, 3000]

type LineHealth = Record<string, { ok?: number; bad?: number }>

let searchToken = readToken()
const lineHealth = readLineHealth()
let solving: Promise<void> | null = null
/** 每写一次校验 Cookie 加一。请求发出后 Cookie 换过，撞上的校验页就不用再解。 */
let cookieEpoch = 0
const playCache = new Map<string, { at: number; value: { url: string; line: string } }>()
const playInflight = new Map<string, Promise<{ url: string; line: string }>>()
const preferredLine = new Map<string, string>()

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function tone(id: string): [string, string] {
  let n = 0
  for (const ch of id) n = (n * 33 + ch.charCodeAt(0)) >>> 0
  const hue = n % 360
  return [`hsl(${hue} 42% 28%)`, `hsl(${(hue + 32) % 360} 48% 42%)`]
}

function blankItem(partial: Partial<VideoItem> & { id: string; title: string }): VideoItem {
  return {
    id: partial.id,
    title: partial.title,
    channel: partial.channel || 'movie',
    genres: partial.genres || [],
    region: partial.region || '',
    year: partial.year || 0,
    score: partial.score || 0,
    hot: partial.hot || 0,
    badge: partial.badge,
    updateText: partial.updateText || '正片',
    actors: partial.actors || [],
    director: partial.director || '',
    summary: partial.summary || '',
    tone: tone(partial.id),
    mark: partial.title.slice(0, 1),
    featured: partial.featured || false,
    cover: partial.cover || '',
    episodes: partial.episodes || [],
  }
}

function solveChallenge(html: string): string {
  const prefix = html.match(/'([0-9A-F]{40})'/)?.[1]
  if (!prefix) return ''
  const index = Number.parseInt(prefix[0], 16)
  for (let i = 0; i < 5_000_000; i += 1) {
    const digest = sha1(prefix + i)
    if (digest[index] === 0xb0 && digest[index + 1] === 0x0b) return `${prefix}${i}`
  }
  return ''
}

async function fetchSource(url: string, init: RequestInit | undefined, fallback: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new Error(fallback)
  }
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

function noteToken(html: string) {
  const token = html.match(/name="t" value="([^"]+)"/)?.[1]
  if (!token || token === searchToken) return
  searchToken = token
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 存不下就只记在这一页里 */
  }
}

function isChallenge(response: Response, html: string): boolean {
  // 线上和开发代理会把 850 改写成 200,正文里仍有校验脚本。
  return response.status === 850 || html.includes('cdndefend_js_cookie')
}

/** 撞上校验页就地解题写 Cookie。几页同时撞上时只解一次。 */
function passChallenge(html: string): Promise<void> {
  solving ??= Promise.resolve()
    .then(() => {
      const solved = solveChallenge(html)
      if (!solved) throw new Error('片库暂时没有打开')
      document.cookie = `cdndefend_js_cookie=${solved}; path=/api-video-pomelo7-server/vod`
      cookieEpoch += 1
    })
    .finally(() => {
      solving = null
    })
  return solving
}

/** 这次没打开，过一会儿可能就好了。 */
class PassingFailure extends Error {}

/** 片库所在的 CDN 出故障时回它自己的默认页，状态照样是 200。 */
function isDefaultSite(html: string): boolean {
  return html.includes('Welcome to OpenResty')
}

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 直接请求要的页面；回来的是校验页才解题再请求一次，不先去首页探 Cookie。 */
async function readPage(path: string, signal?: AbortSignal): Promise<string> {
  const read = async () => {
    try {
      const response = await fetch(vodUrl(path), { credentials: 'same-origin', signal })
      return { response, html: await response.text() }
    } catch {
      throw new PassingFailure('片库这会儿没有连上。')
    }
  }
  const epoch = cookieEpoch
  let { response, html } = await read()
  if (isChallenge(response, html)) {
    if (epoch === cookieEpoch) await passChallenge(html)
    ;({ response, html } = await read())
  }
  if (response.status === 200 && !isChallenge(response, html) && !isDefaultSite(html)) {
    noteToken(html)
    return html
  }
  const { status } = response
  const passing = status === 404 || status === 429 || (status >= 500 && status < 600) || isDefaultSite(html)
  throw passing ? new PassingFailure('片库暂时没有打开') : new Error('片库暂时没有打开')
}

async function fetchHtml(path: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readPage(path, signal)
    } catch (error) {
      if (signal?.aborted || !(error instanceof PassingFailure) || attempt >= PAGE_RETRY.length) throw error
    }
    await pause(PAGE_RETRY[attempt], signal)
  }
}

function visibleTitle(block: string): string {
  const titles = [...block.matchAll(/<div class="v-item-title"([^>]*)>([^<]*)<\/div>/g)]
  for (const match of titles) {
    if (/display:\s*none/.test(match[1])) continue
    const text = decode(match[2])
    if (!text || /可可影视|kkys/i.test(text)) continue
    return text
  }
  return ''
}

function parseCards(html: string, channel: ChannelId, offset = 0): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="v-item">([\s\S]*?)<\/a>/g
  let index = offset
  for (const match of html.matchAll(re)) {
    const id = match[1]
    const block = match[2]
    const title = visibleTitle(block)
    if (!title) continue
    const cover = block
      .match(/data-original="([^"]+)"/g)
      ?.map((item) => item.slice(15, -1))
      .find((item) => item.includes('/vod1/') || item.includes('/cover/'))
    const scoreText = block.match(/豆瓣:\s*([0-9.]+)/)?.[1]
    const badge = decode((block.match(/<div class="v-item-bottom">[\s\S]*?<span>\s*([^<]+?)\s*<\/span>/) || [])[1] || '')
    items.push(
      blankItem({
        id,
        title,
        channel,
        cover: coverUrl(cover || ''),
        score: scoreText ? Number(scoreText) : 0,
        hot: 1000 - index,
        badge: badge || undefined,
        updateText: badge || '正片',
        featured: false,
      }),
    )
    index += 1
  }
  return items
}

/** 首页按栏目读：栏目链到哪个频道、或标题写明是哪一类，片子就先归到那里；推荐、最近更新这类混排栏目先记作电影，等频道页回来再纠正。 */
function parseHome(html: string): VideoItem[] {
  let items: VideoItem[] = []
  for (const section of html.split('<div class="section-header">').slice(1)) {
    const title = decode((section.match(/<div class="section-header-title">([^<]*)/) || [])[1] || '')
    const channelNo = (section.match(/<a href="\/channel\/(\d+)\.html" class="section-header-more"/) || [])[1]
    const channel = CHANNEL_BY_NO[channelNo || ''] || SECTION_CHANNELS.find(([pattern]) => pattern.test(title))?.[1] || 'movie'
    items = merge(items, parseCards(section, channel, items.length))
  }
  return items
}

function parseCarousel(html: string): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="carousel-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="carousel-item-title">([^<]*)<\/div>/) || [])[1] || '')
    if (!title) continue
    const summary = decode((block.match(/<div class="carousel-item-desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = (block.match(/data-original="([^"]+)"/) || [])[1] || ''
    const tags = [...block.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((item) => decode(item[1]))
    items.push(
      blankItem({
        id: match[1],
        title,
        channel: 'movie',
        cover: coverUrl(cover),
        summary,
        badge: tags[0] || '焦点',
        updateText: tags[0] || '正片',
        featured: true,
        hot: 2000 - items.length,
      }),
    )
  }
  return items
}

function lineRank(label = '', note = ''): number {
  const text = `${label} ${note}`
  if (/4K|超清/.test(text)) return 40
  if (/播放快/.test(text)) return 0
  if (/标清/.test(text)) return 1
  if (/720/.test(text)) return 2
  if (/大陆/.test(text)) return 3
  if (/高清/.test(text)) return 8
  if (/香港/.test(text)) return 10
  return 20
}

function readLineHealth(): LineHealth {
  try {
    const saved = JSON.parse(localStorage.getItem(LINE_HEALTH_KEY) || '{}') as LineHealth
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

/** 记下这条线路最近一次能不能播。各部片子的线路名字是通用的，换一部片子也用得上。 */
function noteLine(entry: { label: string; note: string }, ok: boolean) {
  const key = lineSignature(entry)
  if (!key) return
  lineHealth[key] = ok ? { ok: Date.now() } : { ...lineHealth[key], bad: Date.now() }
  try {
    localStorage.setItem(LINE_HEALTH_KEY, JSON.stringify(lineHealth))
  } catch {
    /* 存不下就只在这一页里用 */
  }
}

/** 最近能播的排最前，最近播不了的（比如浏览器跨域读不到的）排最后，其余按线路名字排。 */
function lineScore(entry: PlayLine): number {
  const health = lineHealth[lineSignature(entry)]
  const recent = (at?: number) => (at && Date.now() - at < LINE_MEMORY ? at : 0)
  const ok = recent(health?.ok)
  const bad = recent(health?.bad)
  const rank = lineRank(entry.label, entry.note)
  if (ok > bad) return rank - 100
  return bad ? rank + 100 : rank
}

function parseDetail(html: string, id: string): VideoItem {
  const titleBlock = html.match(/<div class="detail-title">([\s\S]*?)<\/div>/)?.[1] || ''
  const titles = [...titleBlock.matchAll(/<strong>([^<]*)<\/strong>/g)].map((item) => decode(item[1]))
  const title = titles.find((item) => item && !/[𝕜𝕜𝕪𝕤]|kkys|\.com/i.test(item)) || titles[1] || id
  const tags = [...(html.match(/<div class="detail-tags[\s\S]*?<\/div>/)?.[0] || '').matchAll(/>([^<]+)<\/a>/g)]
    .map((item) => decode(item[1]))
    .filter(Boolean)
  const yearTag = tags.find((item) => /^\d{4}$/.test(item))
  const year = Number(yearTag || (html.match(/首映:[\s\S]*?<div class="detail-info-row-main">(\d{4})/) || [])[1] || 0)
  const region = tags.find((item) => item !== yearTag && !/^\d{4}$/.test(item) && item.length <= 8) || ''
  const genres = tags.filter((item) => item !== yearTag && item !== region)
  const summary = decode((html.match(/<div class="detail-desc">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1] || '')
  const director = decode((html.match(/导演:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const actorBlock = (html.match(/演员:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || ''
  const actors = [...actorBlock.matchAll(/>([^<]+)<\/a>/g)].map((item) => decode(item[1])).filter(Boolean)
  const note = decode((html.match(/备注:[\s\S]*?<div class="detail-info-row-main">([^<]+)/) || [])[1] || '')
  const cover = (html.match(/<div class="detail-pic">[\s\S]*?data-original="([^"]+)"/) || [])[1] || ''
  const channelNo = (html.match(/\/show\/(\d+)/) || [])[1]
  const scoreText = html.match(/豆瓣[:：]\s*([0-9.]+)/)?.[1]
  const sources = [...html.matchAll(/<a href="#" class="source-item[^"]*">([\s\S]*?)<\/a>/g)].map((item) => ({
    label: decode((item[1].match(/source-item-label">([^<]+)/) || [])[1] || ''),
    note: decode((item[1].match(/source-item-sublabel">([^<]+)/) || [])[1] || ''),
  }))
  const lists = [...html.matchAll(/<div class="episode-list"[^>]*>([\s\S]*?)<\/div>/g)].map((item) =>
    [...item[1].matchAll(/<a href="(\/play\/[^"]+)"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)].map((episode) => ({
      playPath: episode[1],
      title: decode(episode[2]),
    })),
  )
  const order = lists
    .map((_, index) => index)
    .sort((a, b) => lineRank(sources[a]?.label, sources[a]?.note) - lineRank(sources[b]?.label, sources[b]?.note))
  const width = Math.max(0, ...lists.map((list) => list.length))
  const episodes = []
  for (let index = 0; index < width; index += 1) {
    const lines: PlayLine[] = order
      .filter((sourceIndex) => lists[sourceIndex][index])
      .map((sourceIndex) => ({
        label: sources[sourceIndex]?.label || `线路${sourceIndex + 1}`,
        note: sources[sourceIndex]?.note || '',
        playPath: lists[sourceIndex][index].playPath,
      }))
    if (!lines.length) continue
    const titled = order.map((sourceIndex) => lists[sourceIndex][index]).find(Boolean)
    episodes.push({
      id: String(episodes.length + 1),
      title: titled?.title || `第${episodes.length + 1}集`,
      url: '',
      playPath: lines[0].playPath,
      lines,
    })
  }
  return blankItem({
    id,
    title,
    channel: CHANNEL_BY_NO[channelNo || ''] || 'movie',
    genres,
    region,
    year,
    score: scoreText ? Number(scoreText) : 0,
    hot: 1,
    badge: note || undefined,
    updateText: episodes.length > 1 ? `更新至${episodes.length}集` : note || '正片',
    actors,
    director,
    summary,
    cover: coverUrl(cover),
    episodes,
  })
}

function parseSearch(html: string): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="search-result-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="title">([^<]+)/) || [])[1] || '')
    if (!title) continue
    const kind = decode((block.match(/search-result-item-header">\s*<div>([^<]+)/) || [])[1] || '')
    const tagBlock = (block.match(/<div class="tags">([\s\S]*?)<\/div>/) || [])[1] || ''
    const tags = [...tagBlock.matchAll(/<span>([^<]+)<\/span>/g)].map((span) => decode(span[1]))
    const year = Number(tags.find((item) => /^\d{4}$/.test(item)) || 0)
    const region = tags.find((item) => item !== String(year) && !item.includes(',')) || ''
    const genres = tags
      .flatMap((item) => (item.includes(',') ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean)
    const actors = decode((block.match(/<div class="actors">[\s\S]*?<span>([^<]*)<\/span>/) || [])[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const summary = decode((block.match(/<div class="desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = [...block.matchAll(/data-original="([^"]+)"/g)].map((item) => item[1]).find((item) => item.includes('/vod1/'))
    items.push(
      blankItem({
        id: match[1],
        title,
        channel: TYPE_CHANNEL[kind] || 'movie',
        genres,
        region,
        year,
        actors,
        summary,
        cover: coverUrl(cover || ''),
        hot: 500 - items.length,
        updateText: kind || '正片',
      }),
    )
  }
  return items
}

function merge(base: VideoItem[], extra: VideoItem[]): VideoItem[] {
  const map = new Map(base.map((item) => [item.id, item]))
  for (const item of extra) {
    const prev = map.get(item.id)
    if (!prev) {
      map.set(item.id, item)
      continue
    }
    if (!prev.cover && item.cover) prev.cover = item.cover
    if (!prev.summary && item.summary) prev.summary = item.summary
    if (!prev.score && item.score) prev.score = item.score
    if (item.featured) prev.featured = true
    if (item.hot > prev.hot) prev.hot = item.hot
    if (item.channel && prev.channel === 'movie' && item.channel !== 'movie') prev.channel = item.channel
  }
  return [...map.values()]
}

function parsePlay(html: string): string {
  const src = html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/)?.[1]
  if (!src) throw new Error('这一集没有播放地址')
  return src
}

function chooseVariant(text: string, playlistUrl: string): string {
  if (!text.includes('#EXT-X-STREAM-INF')) return playlistUrl
  const rows = text.split(/\r?\n/)
  const variants: { bandwidth: number; url: string }[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number((rows[index].match(/BANDWIDTH=(\d+)/) || [])[1] || 0)
    const uri = (rows[index + 1] || '').trim()
    if (!uri || uri.startsWith('#')) continue
    variants.push({ bandwidth, url: new URL(uri, playlistUrl).href })
  }
  if (!variants.length) return playlistUrl
  const usable = variants.filter((item) => item.bandwidth > 0 && item.bandwidth <= 1_000_000)
  const pool = usable.length ? usable : variants
  const sorted = usable.length
    ? pool.sort((a, b) => b.bandwidth - a.bandwidth)
    : pool.sort((a, b) => a.bandwidth - b.bandwidth)
  return sorted[0].url
}

function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ms)
  signal?.addEventListener(
    'abort',
    () => {
      window.clearTimeout(timer)
      controller.abort()
    },
    { once: true },
  )
  return controller.signal
}

async function readPlaylist(upstream: string, signal?: AbortSignal): Promise<{ text: string; url: string }> {
  const response = await fetchSource(playProxy(upstream), { signal: timeoutSignal(7000, signal) }, '这一段暂时拿不到。')
  const text = await response.text()
  if (!response.ok || !text.includes('#EXTM3U')) throw new Error('播放列表无效')
  // 有的线路先跳到别的节点，片段只能按跳转后的地址取；原地址只回“OK”几个字节。
  return { text, url: upstreamFromPlay(response.url) || response.url || upstream }
}

function looksLikeMedia(buf: Uint8Array): boolean {
  if (buf.length < 188) return false
  if (buf[0] === 0x47) return true
  const head = String.fromCharCode(...buf.subarray(0, 32))
  return head.includes('ftyp')
}

async function readLimited(
  url: string,
  ms: number,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; aborted: boolean; size: number; headerSize: number }> {
  const response = await fetchSource(url, { signal }, '这一段暂时拿不到。')
  if (!response.ok || !response.body) throw new Error('片段没有回应')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let aborted = false
  const timer = window.setTimeout(() => {
    aborted = true
    void reader.cancel()
  }, ms)
  try {
    while (true) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      total += step.value.length
    }
  } catch {
    aborted = true
  } finally {
    window.clearTimeout(timer)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const headerSize = Number(response.headers.get('content-length') || 0)
  return { bytes, aborted, size: headerSize || total, headerSize }
}

type ProbeEntry = PlayLine & { mediaUrl?: string; ratio?: number; bitrate?: number }

function seriesId(playPath: string) {
  return playPath.match(/\/play\/(\d+)-/)?.[1] || ''
}

function lineSignature(entry: { label: string; note: string }) {
  return `${entry.label} ${entry.note}`.trim()
}

function playValue(entry: ProbeEntry) {
  return {
    url: absolutePlayUrl(entry.mediaUrl || ''),
    line: [entry.label, entry.note].filter(Boolean).join(' · '),
  }
}

function streamUrl(_playlistText: string, playlistUrl: string, mediaUrl: string) {
  return mediaUrl || playlistUrl
}

function firstSegment(text: string) {
  const rows = text.split(/\r?\n/)
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXTINF:')) continue
    const duration = Number.parseFloat(rows[index].slice(8))
    const segment = (rows[index + 1] || '').trim()
    if (segment && !segment.startsWith('#') && duration > 0) return { duration, segment }
  }
  return { duration: 0, segment: '' }
}

async function probeEntry(entry: PlayLine, quick = false, signal?: AbortSignal): Promise<ProbeEntry | null> {
  const html = await fetchHtml(entry.playPath, signal)
  const master = parsePlay(html)
  const playlist = await readPlaylist(master, signal)
  const variantUrl = chooseVariant(playlist.text, playlist.url)
  const media = variantUrl === playlist.url ? playlist : await readPlaylist(variantUrl, signal)
  if (quick) {
    const first = firstSegment(media.text)
    if (!first.segment) return null
    const segmentUrl = new URL(first.segment, media.url).href
    const started = Date.now()
    const sample = await readLimited(playProxy(segmentUrl), 5000, signal).catch(() => null)
    // 片段读不到，播放器同样读不到。有的节点坏了只回“OK”几个字节，不到一个 TS 包也算读不到。
    if (!sample || sample.bytes.length < 188 || !sample.size) return null
    const elapsed = Math.max((Date.now() - started) / 1000, 0.05)
    return {
      ...entry,
      mediaUrl: streamUrl(playlist.text, playlist.url, media.url),
      bitrate: (sample.size * 8) / first.duration,
      ratio: (sample.bytes.length * first.duration) / (elapsed * sample.size),
    }
  }
  const first = firstSegment(media.text)
  const duration = first.duration
  const segment = first.segment
  if (!segment || !duration) return null
  const segmentUrl = new URL(segment, media.url).href
  const started = Date.now()
  const { bytes, aborted, size, headerSize } = await readLimited(playProxy(segmentUrl), 4000, signal)
  const elapsed = Math.max((Date.now() - started) / 1000, 0.05)
  // 加密的片段开头是密文，认不出 TS 同步字节，交给播放器解密。
  const encrypted = /#EXT-X-KEY:METHOD=(AES-128|SAMPLE-AES)/.test(media.text)
  const playable = encrypted ? bytes.length >= 188 : looksLikeMedia(bytes)
  if (!playable || !size || (aborted && !headerSize)) return null
  return {
    ...entry,
    mediaUrl: streamUrl(playlist.text, playlist.url, media.url),
    ratio: (bytes.length * duration) / (elapsed * size),
  }
}

/**
 * 首页和五个频道页一起请求，回来一页就交给 onPart 显示一次。
 * 每次都按"首页在前、频道按顺序"重新合并，片单顺序不随哪页先回来而变。
 */
export async function loadHome(onPart: (videos: VideoItem[]) => void): Promise<VideoItem[]> {
  const parts: VideoItem[][] = []
  const combined = () => parts.filter(Boolean).reduce(merge, [])
  let failure: unknown
  await Promise.all(
    ['/', ...CHANNELS.map((channel) => channel.path)].map(async (path, index) => {
      try {
        const html = await fetchHtml(path)
        parts[index] = index ? parseCards(html, CHANNELS[index - 1].id) : merge(parseCarousel(html), parseHome(html))
        onPart(combined())
      } catch (error) {
        failure ??= error
      }
    }),
  )
  const videos = combined()
  if (!videos.length) throw failure ?? new Error('片库暂时没有打开')
  return videos
}

export async function loadDetail(id: string): Promise<VideoItem> {
  if (!/^\d+$/.test(id)) throw new Error('没有这部片子')
  return parseDetail(await fetchHtml(`/detail/${id}.html`), id)
}

export async function loadSearch(keyword: string): Promise<VideoItem[]> {
  const q = keyword.trim()
  if (!q) return []
  const search = async (token: string) =>
    parseSearch(await fetchHtml(`/search?k=${encodeURIComponent(q)}${token ? `&t=${encodeURIComponent(token)}` : ''}`))
  const used = searchToken
  const items = await search(used)
  // 口令过期或还没有时，片库只回一页空结果，页面里带着新口令，换上再搜一次。
  if (items.length || !searchToken || searchToken === used) return items
  return search(searchToken)
}

export function loadPlay(entries: PlayLine[], only = false): Promise<{ url: string; line: string }> {
  const list = entries.filter((entry) => PLAY_PATH.test(entry.playPath))
  if (!list.length) return Promise.reject(new Error('没有播放地址'))
  const key = `${only ? '1' : '0'}:${list.map((entry) => entry.playPath).join('|')}`
  const cached = playCache.get(key)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return Promise.resolve(cached.value)
  const pending = playInflight.get(key)
  if (pending) return pending
  const task = resolvePlay(list, only, key)
  playInflight.set(key, task)
  return task.finally(() => {
    playInflight.delete(key)
  })
}

/**
 * 几条线路一起探，按下载快慢排好返回。有一条比播放快 enough 倍就立刻收工；
 * 已经有能播的、只是不够快时，最多再等 PROBE_GRACE。收工时没探完的都停掉，不再占带宽。
 */
function probeRace(entries: PlayLine[], quick: boolean, enough: number): Promise<ProbeEntry[]> {
  const stop = new AbortController()
  const found: ProbeEntry[] = []
  return new Promise((resolve) => {
    let left = entries.length
    let grace = 0
    const limit = window.setTimeout(() => settle(), PROBE_LIMIT)
    const settle = () => {
      window.clearTimeout(grace)
      window.clearTimeout(limit)
      stop.abort()
      resolve(found.sort((a, b) => (b.ratio || 0) - (a.ratio || 0)))
    }
    if (!left) {
      settle()
      return
    }
    for (const entry of entries) {
      void probeEntry(entry, quick, stop.signal)
        .catch(() => null)
        .then((result) => {
          if (stop.signal.aborted) return
          left -= 1
          noteLine(entry, Boolean(result?.mediaUrl))
          if (result?.mediaUrl) found.push(result)
          if (!left || (result?.mediaUrl && (result.ratio || 0) >= enough)) settle()
          else if (found.length && !grace) grace = window.setTimeout(settle, PROBE_GRACE)
        })
    }
  })
}

async function resolvePlay(list: PlayLine[], only: boolean, key: string): Promise<{ url: string; line: string }> {
  const ranked = [...list].sort((a, b) => lineScore(a) - lineScore(b))
  const picked: PlayLine[] = []
  const textOf = (entry: PlayLine) => `${entry.label} ${entry.note}`
  const series = seriesId(list[0].playPath)
  const hint = series ? preferredLine.get(series) : ''
  const hinted = hint ? ranked.find((entry) => lineSignature(entry) === hint) : undefined
  const starters = (only ? [ranked[0]] : [hinted, ...ranked])
    .filter((entry, index, all): entry is PlayLine => Boolean(entry) && all.indexOf(entry) === index)
    .slice(0, STARTERS)
  const take = (match: (text: string) => boolean, limit: number) => {
    let count = 0
    for (const entry of ranked) {
      if (only || picked.length >= 6 || count >= limit) return
      if (starters.includes(entry) || picked.includes(entry) || !match(textOf(entry))) continue
      picked.push(entry)
      count += 1
    }
  }
  const measured = await probeRace(starters, true, QUICK_ENOUGH)
  const bestQuick = measured[0]
  if (bestQuick?.mediaUrl) {
    if (series) preferredLine.set(series, lineSignature(bestQuick))
    const value = playValue(bestQuick)
    playCache.set(key, { at: Date.now(), value })
    return value
  }
  if (only) picked.push(ranked[0])
  take((text) => /播放快|标清|720/.test(text), 2)
  take((text) => /大陆|香港/.test(text), 2)
  take(() => true, 6)
  let pool: ProbeEntry[] = []
  for (let offset = 0; offset < picked.length; offset += 3) {
    pool = pool.concat(await probeRace(picked.slice(offset, offset + 3), false, 1.2))
    if (pool.some((item) => (item.ratio || 0) >= 1.2)) break
  }
  if (!pool.length) throw new Error('这一集没有可播放的线路')
  pool.sort((a, b) => (b.ratio || 0) - (a.ratio || 0))
  const best = pool[0]
  if (series) preferredLine.set(series, lineSignature(best))
  const value = playValue(best)
  playCache.set(key, { at: Date.now(), value })
  return value
}
