# 生产环境  npm run dev:pro / npm run build

VITE_APP_ENV=pro
VITE_APP_TITLE=观影 jun.sun
VITE_BASE=/
VITE_SOURCEMAP=false
VITE_DEV_PORT=5175

# true 封面和播放也走本站代理。false 时封面和播放直连片源。片库页面始终走 /vod。
VITE_USE_PROXY=false

VITE_VOD_TARGET=https://www.dushe05.com
VITE_IMG_TARGET=https://vres.wkcyvs.cn
VITE_IMG_A_TARGET=https://103.39.111.180:51050
VITE_IMG_B_TARGET=https://103.39.111.184:51050
