/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 环境标识: local | dev | test | pro */
  readonly VITE_APP_ENV: 'local' | 'dev' | 'test' | 'pro'
  readonly VITE_APP_TITLE: string
  readonly VITE_BASE: string
  readonly VITE_SOURCEMAP: string
  readonly VITE_DEV_PORT: string
  /** true 封面和播放也走本站代理。false 时封面和播放直连片源。片库页面始终走 /vod。 */
  readonly VITE_USE_PROXY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'mux.js' {
  interface MuxSegment {
    initSegment?: Uint8Array
    data?: Uint8Array
  }

  interface MuxTransmuxer {
    on(event: 'data', listener: (segment: MuxSegment) => void): void
    push(data: Uint8Array): void
    flush(): void
  }

  const muxjs: {
    mp4: {
      Transmuxer: new (options?: { keepOriginalTimestamps?: boolean }) => MuxTransmuxer
    }
  }

  export default muxjs
}
