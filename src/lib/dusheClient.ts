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
const PLAY_PATH = /^\/play\/\d+-\d+-\d+\.html$/

let cookieAt = 0
let searchToken = ''
let homeCache: { videos: VideoItem[] } | null = null
let homeAt = 0
const playCache = new Map<string, { at: number; value: { url: string; line: string } }>()

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

async function ensureCookie(): Promise<void> {
  if (cookieAt && Date.now() - cookieAt < 8 * 60 * 1000) return
  const response = await fetch(vodUrl('/'), { credentials: 'same-origin' })
  const html = await response.text()
  if (response.status === 200 && html.includes('/detail/')) {
    cookieAt = Date.now()
    const token = html.match(/name="t" value="([^"]+)"/)?.[1]
    if (token) searchToken = token
    return
  }
  const solved = solveChallenge(html)
  if (!solved) throw new Error('片库暂时没有打开')
  document.cookie = `cdndefend_js_cookie=${solved}; path=${'/api-video-pomelo7-server/vod'}`
  cookieAt = Date.now()
}

async function fetchHtml(path: string): Promise<string> {
  await ensureCookie()
  const read = async () => {
    const response = await fetch(vodUrl(path), { credentials: 'same-origin' })
    const html = await response.text()
    return { response, html }
  }
  let { response, html } = await read()
  if (response.status === 850 || html.includes("cdndefend_js_cookie")) {
    cookieAt = 0
    document.cookie = 'cdndefend_js_cookie=; Max-Age=0; path=/api-video-pomelo7-server/vod'
    await ensureCookie()
    ;({ response, html } = await read())
  }
  if (response.status !== 200) throw new Error('片库暂时没有打开')
  const token = html.match(/name="t" value="([^"]+)"/)?.[1]
  if (token) searchToken = token
  return html
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

function parseCards(html: string, channel: ChannelId): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="v-item">([\s\S]*?)<\/a>/g
  let index = 0
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
  const usable = variants.filter((item) => item.bandwidth >= 400000 && item.bandwidth <= 2_500_000)
  const pool = usable.length ? usable : variants
  return pool.sort((a, b) => a.bandwidth - b.bandwidth)[0].url
}

async function readPlaylist(upstream: string): Promise<{ text: string; url: string }> {
  const response = await fetch(playProxy(upstream))
  const text = await response.text()
  if (!response.ok || !text.includes('#EXTM3U')) throw new Error('播放列表无效')
  return { text, url: upstreamFromPlay(response.url) || upstream }
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
): Promise<{ bytes: Uint8Array; aborted: boolean; size: number; headerSize: number }> {
  const response = await fetch(url)
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

type ProbeEntry = PlayLine & { mediaUrl?: string; ratio?: number }

async function probeEntry(entry: PlayLine): Promise<ProbeEntry | null> {
  const html = await fetchHtml(entry.playPath)
  const master = parsePlay(html)
  const playlist = await readPlaylist(master)
  const variantUrl = chooseVariant(playlist.text, playlist.url)
  const media = variantUrl === playlist.url ? playlist : await readPlaylist(variantUrl)
  const rows = media.text.split(/\r?\n/)
  let duration = 0
  let segment = ''
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXTINF:')) continue
    duration = Number.parseFloat(rows[index].slice(8))
    segment = (rows[index + 1] || '').trim()
    if (segment && !segment.startsWith('#')) break
  }
  if (!segment || !duration) return null
  const segmentUrl = new URL(segment, media.url).href
  const started = Date.now()
  const { bytes, aborted, size, headerSize } = await readLimited(playProxy(segmentUrl), 8000)
  const elapsed = Math.max((Date.now() - started) / 1000, 0.05)
  if (!looksLikeMedia(bytes) || !size || (aborted && !headerSize)) return null
  return {
    ...entry,
    mediaUrl: media.url,
    ratio: (bytes.length * duration) / (elapsed * size),
  }
}

export async function loadHome(): Promise<{ videos: VideoItem[] }> {
  if (homeCache && Date.now() - homeAt < 3 * 60 * 1000) return homeCache
  const homeHtml = await fetchHtml('/')
  let videos = [...parseCarousel(homeHtml), ...parseCards(homeHtml, 'movie')]
  const channels = await Promise.all(
    CHANNELS.map(async (channel) => {
      try {
        return parseCards(await fetchHtml(channel.path), channel.id)
      } catch {
        return []
      }
    }),
  )
  for (const list of channels) videos = merge(videos, list)
  homeCache = { videos }
  homeAt = Date.now()
  return homeCache
}

export async function loadDetail(id: string): Promise<VideoItem> {
  if (!/^\d+$/.test(id)) throw new Error('没有这部片子')
  return parseDetail(await fetchHtml(`/detail/${id}.html`), id)
}

export async function loadSearch(keyword: string): Promise<VideoItem[]> {
  const q = keyword.trim()
  if (!q) return []
  if (!searchToken) await fetchHtml('/')
  const query = `k=${encodeURIComponent(q)}${searchToken ? `&t=${encodeURIComponent(searchToken)}` : ''}`
  return parseSearch(await fetchHtml(`/search?${query}`))
}

export async function loadPlay(entries: PlayLine[], only = false): Promise<{ url: string; line: string }> {
  const list = entries.filter((entry) => PLAY_PATH.test(entry.playPath))
  if (!list.length) throw new Error('没有播放地址')
  const key = `${only ? '1' : '0'}:${list.map((entry) => entry.playPath).join('|')}`
  const cached = playCache.get(key)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value
  const ranked = [...list].sort((a, b) => lineRank(a.label, a.note) - lineRank(b.label, b.note))
  const picked: PlayLine[] = []
  const textOf = (entry: PlayLine) => `${entry.label} ${entry.note}`
  const take = (match: (text: string) => boolean, limit: number) => {
    let count = 0
    for (const entry of ranked) {
      if (only || picked.length >= 6 || count >= limit) return
      if (picked.includes(entry) || !match(textOf(entry))) continue
      picked.push(entry)
      count += 1
    }
  }
  if (only) picked.push(ranked[0])
  take((text) => /播放快|标清|720/.test(text), 2)
  take((text) => /大陆|香港/.test(text), 2)
  take(() => true, 6)
  let pool: ProbeEntry[] = []
  for (let offset = 0; offset < picked.length; offset += 3) {
    const found = (await Promise.all(picked.slice(offset, offset + 3).map((entry) => probeEntry(entry).catch(() => null)))).filter(
      (item): item is ProbeEntry => Boolean(item?.mediaUrl),
    )
    pool = pool.concat(found)
    if (only || pool.some((item) => (item.ratio || 0) >= 2)) break
  }
  if (!pool.length) throw new Error('这一集没有可播放的线路')
  pool.sort((a, b) => (b.ratio || 0) - (a.ratio || 0))
  const best = pool[0]
  const value = {
    url: absolutePlayUrl(best.mediaUrl || ''),
    line: [best.label, best.note].filter(Boolean).join(' · '),
  }
  playCache.set(key, { at: Date.now(), value })
  return value
}
