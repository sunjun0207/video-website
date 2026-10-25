# 观影 jun.sun 官网（video-website）

jun.sun 的观影官网。版式参照 fmusic-website：顶栏、二级导航、焦点图、片单和页脚。片库与播放沿用 video-h5，搜索和播放在开发时由 Vite 把 `/api-video-pomelo7-server/*` 转发到片库。没有改动 fmusic-website。

## 快速开始

需要 **Node.js ≥ 18**。

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5175/#/discover`。端口用 `5175`，避开 fmusic-h5 的 `5173`，以及 fmusic-website / video-h5 的 `5174`。改完 `.env.local` 后需要重启 `npm run dev`，片库代理才会生效。

```bash
npm run build
npm run preview
```

## 页面

| 地址 | 内容 |
|------|------|
| `#/discover` | 推荐：焦点图、最近看过、频道海报、编辑榜单 |
| `#/toplist` | 排行榜。可加 `/hot`、`/score`、`/new` |
| `#/lists` | 片单 |
| `#/list/lamp` | 片单详情 |
| `#/channels` | 频道 |
| `#/channel/movie` | 频道筛选，可加 `?genre=` `region=` `year=` `sort=` |
| `#/fresh` | 新片 |
| `#/detail/:id` | 详情、选集、收藏 |
| `#/play/:id/:ep` | 播放，记下进度 |
| `#/search?q=` | 搜索片库 |
| `#/favorites` | 收藏和最近看过 |
| `#/guide` | 观影说明 |
| `#/about` | 关于 |

路由使用 hash，静态托管时不需要服务端重写。播放还依赖 `/api-video-pomelo7-server/vod`、`/img` 和 `/play`。Docker 部署会按环境文件把这些路径反代出去。

收藏、观看记录和搜索历史在这台浏览器的 `localStorage`。

## 环境

`.env.local`、`.env.dev`、`.env.test`、`.env.pro` 变量相同，按 Vite mode 覆盖。`npm run dev` 只用 `.env.local`。

| 文件 | 命令 | Docker |
|------|------|--------|
| `.env.dev` | `npm run build:dev` | `npm run docker:dev:up`，默认 `8180` / `8543` |
| `.env.test` | `npm run build:test` | `npm run docker:test:up`，默认 `8190` / `8553` |
| `.env.pro` | `npm run build` | `npm run docker:pro:up`，默认 `80` / `443` |

证书放在 `docker/<env>/ssl/fullchain.pem` 和 `privkey.pem`。

| 变量 | 说明 |
|------|------|
| `VITE_VOD_TARGET` | 片库页面，默认 `https://www.dushe05.com` |
| `VITE_IMG_TARGET` | 封面图 |
| `VITE_IMG_A_TARGET` / `VITE_IMG_B_TARGET` | 封面备用地址 |
| `VITE_DEV_PORT` | 开发端口，默认 `5175` |

和音乐官网、video-h5 同时部署时，用 `HTTP_PORT` / `HTTPS_PORT` 把生产端口错开。

## 技术栈

React 19 · Vite 6 · TypeScript · hls.js · 纯 CSS（Syne + Noto Sans SC）
