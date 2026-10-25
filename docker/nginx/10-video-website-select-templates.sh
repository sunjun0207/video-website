#!/bin/sh
# 放在 /docker-entrypoint.d/,按文件名排序在官方 20-envsubst-on-templates.sh 之前执行。
#
#  1. 校验反代所需的 VITE_*_TARGET(由 compose env_file 加载 .env.<env>)
#  2. 用 envsubst 渲染 /etc/nginx/snippets/app-locations.conf(只替换白名单变量)
#  3. 按 SSL_ENABLED 决定往 /etc/nginx/templates 放哪些 server 模板
set -eu

AVAILABLE=/etc/nginx/templates-available
TEMPLATES=/etc/nginx/templates
SNIPPETS=/etc/nginx/snippets
SSL_DIR=/etc/nginx/ssl

log() { echo "[video-website] $*"; }
die() { echo "[video-website] ERROR: $*" >&2; exit 1; }

required="VITE_VOD_TARGET VITE_IMG_TARGET VITE_IMG_A_TARGET VITE_IMG_B_TARGET"
for v in $required; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || die "缺少环境变量 $v(compose 需通过 env_file 加载 .env.local / .env.dev / .env.pro)"
  case "$val" in
    http://*|https://*) ;;
    *) die "$v=$val 必须以 http:// 或 https:// 开头" ;;
  esac
done

mkdir -p "$TEMPLATES" "$SNIPPETS"
whitelist='${VITE_VOD_TARGET} ${VITE_IMG_TARGET} ${VITE_IMG_A_TARGET} ${VITE_IMG_B_TARGET}'
envsubst "$whitelist" \
  < "$AVAILABLE/app-locations.conf.template" \
  > "$SNIPPETS/app-locations.conf"
log "已渲染 app-locations.conf:vod=$VITE_VOD_TARGET img=$VITE_IMG_TARGET"

rm -f "$TEMPLATES"/*.template
if [ "${SSL_ENABLED:-false}" = "true" ]; then
  for f in fullchain.pem privkey.pem; do
    [ -s "$SSL_DIR/$f" ] || die "SSL_ENABLED=true 但 $SSL_DIR/$f 不存在或为空;请把证书放到 docker/<env>/ssl/ 后重启,或将 SSL_ENABLED 设为 false"
  done
  cp "$AVAILABLE/http-redirect.conf.template" "$TEMPLATES/00-http.conf.template"
  cp "$AVAILABLE/https.conf.template"         "$TEMPLATES/10-https.conf.template"
  log "HTTPS 已启用:server_name=${SERVER_NAME:-_},80 → https://<host>${HTTPS_REDIRECT_PORT:-} 跳转"
else
  cp "$AVAILABLE/http.conf.template" "$TEMPLATES/00-http.conf.template"
  log "仅 HTTP:server_name=${SERVER_NAME:-_}"
fi
