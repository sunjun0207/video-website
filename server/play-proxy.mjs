import http from 'node:http'
import https from 'node:https'

const PLAY = /^\/api-video-pomelo7-server\/play\/(https?)\/([^/]+)\/(\d+)(\/.*)$/
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function blocked(host) {
  const name = host.toLowerCase()
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.internal')) return true
  if (/^(127\.|10\.|0\.|192\.168\.|169\.254\.)/.test(name)) return true
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(name)
}

function playPath(target) {
  const scheme = target.protocol === 'https:' ? 'https' : 'http'
  const port = target.port || (scheme === 'https' ? '443' : '80')
  return `/api-video-pomelo7-server/play/${scheme}/${target.hostname}/${port}${target.pathname}${target.search}`
}

function playProxy(req, res, next) {
  const raw = req.url || ''
  const queryAt = raw.indexOf('?')
  const path = queryAt >= 0 ? raw.slice(0, queryAt) : raw
  const search = queryAt >= 0 ? raw.slice(queryAt) : ''
  const matched = path.match(PLAY)
  if (!matched) {
    next()
    return
  }
  const scheme = matched[1]
  const host = matched[2]
  const port = matched[3]
  const upstreamPath = matched[4]
  if (blocked(host) || Number(port) < 1 || Number(port) > 65535) {
    res.statusCode = 403
    res.end()
    return
  }
  const lib = scheme === 'https' ? https : http
  const headers = { ...req.headers }
  delete headers.cookie
  delete headers.origin
  delete headers.referer
  delete headers.host
  headers.host = port === '80' || port === '443' ? host : `${host}:${port}`
  headers.referer = 'https://www.dushe05.com/'
  headers['user-agent'] = UA
  delete headers['accept-encoding']
  const upstream = lib.request(
    {
      hostname: host,
      port: Number(port),
      method: req.method,
      path: `${upstreamPath}${search}`,
      headers,
      rejectUnauthorized: false,
      timeout: 60000,
    },
    (incoming) => {
      const location = incoming.headers.location
      if (incoming.statusCode && incoming.statusCode >= 300 && incoming.statusCode < 400 && location) {
        const nextUrl = new URL(location, `${scheme}://${host}:${port}${upstreamPath}`)
        res.statusCode = incoming.statusCode
        res.setHeader('Location', playPath(nextUrl))
        incoming.resume()
        res.end()
        return
      }
      const out = { ...incoming.headers }
      delete out['set-cookie']
      res.writeHead(incoming.statusCode || 502, out)
      incoming.pipe(res)
      res.on('close', () => incoming.destroy())
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  upstream.on('timeout', () => upstream.destroy())
  req.pipe(upstream)
}

export function playProxyPlugin() {
  return {
    name: 'video-play-proxy',
    configureServer(server) {
      server.middlewares.use(playProxy)
    },
    configurePreviewServer(server) {
      server.middlewares.use(playProxy)
    },
  }
}
