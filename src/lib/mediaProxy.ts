/** 片库页面始终走本站 /vod。封面和播放只在 VITE_USE_PROXY=true 时走本站代理。 */
export const API_PREFIX = '/api-video-pomelo7-server'

const PAGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const PROXY_HEADERS = {
  Referer: 'https://www.dushe05.com/',
  'User-Agent': PAGE_UA,
}

export const useSourceProxy = import.meta.env.VITE_USE_PROXY === 'true'

function originOf(value: string) {
  return value.replace(/\/$/, '')
}

const IMG_HOSTS = [
  originOf(import.meta.env.VITE_IMG_TARGET || ''),
  originOf(import.meta.env.VITE_IMG_A_TARGET || ''),
  originOf(import.meta.env.VITE_IMG_B_TARGET || ''),
].filter(Boolean)

export function vodUrl(path: string): string {
  if (path.startsWith('http')) {
    const target = new URL(path)
    return `${API_PREFIX}/vod${target.pathname}${target.search}`
  }
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_PREFIX}/vod${normalized}`
}

export function coverUrl(raw: string): string {
  if (!raw || raw.includes('logo_placeholder')) return ''
  if (!useSourceProxy) {
    if (raw.startsWith('http')) return raw
    if (raw.startsWith('/') && IMG_HOSTS[0]) return `${IMG_HOSTS[0]}${raw}`
    return ''
  }
  if (raw.startsWith('/')) return `${API_PREFIX}/img${raw}`
  try {
    const target = new URL(raw)
    const origin = `${target.protocol}//${target.host}`
    const prefix =
      origin === 'https://103.39.111.180:51050'
        ? `${API_PREFIX}/img-a`
        : origin === 'https://103.39.111.184:51050'
          ? `${API_PREFIX}/img-b`
          : `${API_PREFIX}/img`
    return `${prefix}${target.pathname}${target.search}`
  } catch {
    return ''
  }
}

export function nextCover(url: string): string {
  if (!useSourceProxy) {
    const current = IMG_HOSTS.findIndex((host) => url.startsWith(`${host}/`))
    const next = IMG_HOSTS[current + 1]
    if (current < 0 || !next) return ''
    return `${next}${url.slice(IMG_HOSTS[current].length)}`
  }
  if (url.includes(`${API_PREFIX}/img/`)) return url.replace(`${API_PREFIX}/img/`, `${API_PREFIX}/img-a/`)
  if (url.includes(`${API_PREFIX}/img-a/`)) return url.replace(`${API_PREFIX}/img-a/`, `${API_PREFIX}/img-b/`)
  return ''
}

export function playProxy(absolute: string): string {
  if (!useSourceProxy) return absolute
  const target = new URL(absolute)
  const scheme = target.protocol === 'https:' ? 'https' : 'http'
  const port = target.port || (scheme === 'https' ? '443' : '80')
  return `${API_PREFIX}/play/${scheme}/${target.hostname}/${port}${target.pathname}${target.search}`
}

export function absolutePlayUrl(absolute: string): string {
  if (!useSourceProxy) return absolute
  return new URL(playProxy(absolute), window.location.origin).href
}

const AD_BREAK_MAX = 40

/** 正片之间不足 40 秒、且旁边有一段足够长的不连续片段，按插播广告去掉。 */
export function stripAdBreaks(text: string): string {
  if (!text.includes('#EXTINF')) return text
  const rows = text.split(/\r?\n/)
  const head: string[] = []
  const groups: { lines: string[]; duration: number; adUri: boolean }[] = []
  let current: { lines: string[]; duration: number; adUri: boolean } | null = null
  let seenMedia = false
  for (const line of rows) {
    const trimmed = line.trim()
    if (trimmed === '#EXT-X-DISCONTINUITY') {
      if (current) groups.push(current)
      current = { lines: [], duration: 0, adUri: false }
      seenMedia = true
      continue
    }
    if (trimmed === '#EXT-X-ENDLIST') continue
    if (!seenMedia && (trimmed.startsWith('#') || !trimmed)) {
      head.push(line)
      continue
    }
    if (!current) current = { lines: [], duration: 0, adUri: false }
    seenMedia = true
    current.lines.push(line)
    const inf = trimmed.match(/^#EXTINF:([\d.]+)/)
    if (inf) current.duration += Number(inf[1])
    if (trimmed && !trimmed.startsWith('#') && /(?:^|\/)(?:ad|ads|adv|adjump|gg)(?:\/|\.|$)|广告/i.test(trimmed)) {
      current.adUri = true
    }
  }
  if (current) groups.push(current)
  const hasProgram = groups.some((group) => group.duration >= 90)
  const kept = groups.filter((group) => {
    if (!hasProgram) return true
    if (group.adUri) return false
    return !(group.duration > 0 && group.duration <= AD_BREAK_MAX)
  })
  if (!kept.length || kept.length === groups.length) return text
  const body = kept.flatMap((group, index) => (index ? ['#EXT-X-DISCONTINUITY', ...group.lines] : group.lines))
  const ended = rows.some((line) => line.trim() === '#EXT-X-ENDLIST')
  return [...head, ...body, ...(ended ? ['#EXT-X-ENDLIST'] : [])].join('\n')
}

export function upstreamFromPlay(value: string): string | null {
  const path = value.startsWith('http') ? `${new URL(value).pathname}${new URL(value).search}` : value
  const matched = path.match(/^\/api-video-pomelo7-server\/play\/(https?)\/([^/]+)\/(\d+)(\/.*)$/)
  if (!matched) return null
  const scheme = matched[1]
  const host = matched[2]
  const port = matched[3]
  const rest = matched[4]
  const omit = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')
  return `${scheme}://${host}${omit ? '' : `:${port}`}${rest}`
}

export function rewritePlaylist(text: string, upstreamUrl: string): string {
  const cleaned = stripAdBreaks(text)
  if (!useSourceProxy) return cleaned
  const base = new URL(upstreamUrl)
  const mapUri = (uri: string) => absolutePlayUrl(new URL(uri, base).href)
  return cleaned
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${mapUri(uri)}"`)
      return mapUri(line.trim())
    })
    .join('\n')
}
