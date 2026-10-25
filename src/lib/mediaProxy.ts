/** 与 nginx / vite 反代同一套前缀，浏览器只请求本站。 */
export const API_PREFIX = '/api-video-pomelo7-server'

const PAGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const PROXY_HEADERS = {
  Referer: 'https://www.dushe05.com/',
  'User-Agent': PAGE_UA,
}

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
  if (url.includes(`${API_PREFIX}/img/`)) return url.replace(`${API_PREFIX}/img/`, `${API_PREFIX}/img-a/`)
  if (url.includes(`${API_PREFIX}/img-a/`)) return url.replace(`${API_PREFIX}/img-a/`, `${API_PREFIX}/img-b/`)
  return ''
}

export function playProxy(absolute: string): string {
  const target = new URL(absolute)
  const scheme = target.protocol === 'https:' ? 'https' : 'http'
  const port = target.port || (scheme === 'https' ? '443' : '80')
  return `${API_PREFIX}/play/${scheme}/${target.hostname}/${port}${target.pathname}${target.search}`
}

export function absolutePlayUrl(absolute: string): string {
  return new URL(playProxy(absolute), window.location.origin).href
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
  const base = new URL(upstreamUrl)
  const mapUri = (uri: string) => absolutePlayUrl(new URL(uri, base).href)
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${mapUri(uri)}"`)
      return mapUri(line.trim())
    })
    .join('\n')
}
