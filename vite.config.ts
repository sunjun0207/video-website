import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { playProxyPlugin } from './server/play-proxy.mjs'

const PAGE_HEADERS = {
  Referer: 'https://www.dushe05.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

/** 浏览器只请求 /api-video-pomelo7-server。开发代理与线上 nginx 使用同一组 *_TARGET。 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const proxyRule = (prefix: string, target: string, rewriteChallenge = false): ProxyOptions => ({
    target,
    changeOrigin: true,
    secure: false,
    rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
    headers: PAGE_HEADERS,
    configure(proxy) {
      proxy.on('proxyRes', (proxyRes) => {
        // 片库校验是 850。改成 200 后，这次 fetch 不会出现在浏览器的失败列表里。
        if (rewriteChallenge && proxyRes.statusCode === 850) proxyRes.statusCode = 200
        proxyRes.headers['access-control-allow-origin'] = '*'
        proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS'
        proxyRes.headers['access-control-allow-headers'] = '*'
      })
    },
  })
  const proxy: Record<string, ProxyOptions> = {
    '/api-video-pomelo7-server/vod': proxyRule('/api-video-pomelo7-server/vod', env.VITE_VOD_TARGET, true),
    '/api-video-pomelo7-server/img-a': proxyRule('/api-video-pomelo7-server/img-a', env.VITE_IMG_A_TARGET),
    '/api-video-pomelo7-server/img-b': proxyRule('/api-video-pomelo7-server/img-b', env.VITE_IMG_B_TARGET),
    '/api-video-pomelo7-server/img': proxyRule('/api-video-pomelo7-server/img', env.VITE_IMG_TARGET),
  }

  return {
    base: env.VITE_BASE || '/',
    plugins: [react(), playProxyPlugin()],
    server: {
      host: true,
      port: Number(env.VITE_DEV_PORT) || 5175,
      proxy,
    },
    preview: {
      host: true,
      port: Number(env.VITE_DEV_PORT) || 5175,
      proxy,
    },
    build: {
      sourcemap: env.VITE_SOURCEMAP === 'true',
      // hls.js 完整版单独一块约 600 kB，拆不开；它只在详情页、播放页按需加载，不进首屏。
      chunkSizeWarningLimit: 650,
    },
  }
})
