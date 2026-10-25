/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 环境标识: local | dev | test | pro */
  readonly VITE_APP_ENV: 'local' | 'dev' | 'test' | 'pro'
  readonly VITE_APP_TITLE: string
  readonly VITE_BASE: string
  readonly VITE_SOURCEMAP: string
  readonly VITE_DEV_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
