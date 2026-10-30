#!/bin/sh
# 放在 /docker-entrypoint.d/,按文件名排序在官方 20-envsubst-on-templates.sh 之前执行。
#
#  1. 校验反代所需的 VITE_*_TARGET(由 compose env_file 加载 .env.<env>)
#  2. 用 envsubst 渲染 /etc/nginx/snippets/app-locations.conf 和 /etc/nginx/conf.d/vod-upstream.conf(只替换白名单变量)
#  3. 按 VITE_VOD_BACKUP_TARGETS 生成片库备用地址 vod-failover.conf / vod-backups.conf
#  4. 按 SSL_ENABLED 决定往 /etc/nginx/templates 放哪些 server 模板
set -eu

AVAILABLE=/etc/nginx/templates-available
TEMPLATES=/etc/nginx/templates
SNIPPETS=/etc/nginx/snippets
CONF_D=/etc/nginx/conf.d
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

# 片库地址拆成 upstream 要的几段:http(s)://主机[:端口][/路径]
vod_rest=${VITE_VOD_TARGET#*://}
VOD_SCHEME=${VITE_VOD_TARGET%%://*}
VOD_HOSTPORT=${vod_rest%%/*}
VOD_HOST=${VOD_HOSTPORT%%:*}
VOD_PATH=
case "$vod_rest" in */*) VOD_PATH=/${vod_rest#*/} ;; esac
VOD_PATH=${VOD_PATH%/}
case "$VOD_HOSTPORT" in
  *:*) VOD_SERVER=$VOD_HOSTPORT ;;
  *) if [ "$VOD_SCHEME" = https ]; then VOD_SERVER=$VOD_HOST:443; else VOD_SERVER=$VOD_HOST:80; fi ;;
esac
export VOD_SCHEME VOD_HOST VOD_HOSTPORT VOD_SERVER VOD_PATH

mkdir -p "$TEMPLATES" "$SNIPPETS"
whitelist='${VITE_VOD_TARGET} ${VITE_IMG_TARGET} ${VITE_IMG_A_TARGET} ${VITE_IMG_B_TARGET} ${VOD_SCHEME} ${VOD_HOST} ${VOD_HOSTPORT} ${VOD_SERVER} ${VOD_PATH}'
envsubst "$whitelist" \
  < "$AVAILABLE/app-locations.conf.template" \
  > "$SNIPPETS/app-locations.conf"
envsubst "$whitelist" \
  < "$AVAILABLE/vod-upstream.conf.template" \
  > "$CONF_D/vod-upstream.conf"
log "已渲染 app-locations.conf / vod-upstream.conf:vod=$VITE_VOD_TARGET($VOD_SERVER) img=$VITE_IMG_TARGET"

# 片库备用地址(可选,逗号分隔):同一个片库的其他域名。主地址回 404 / 5xx 或连不上时依次改走下一个。
# vod-failover.conf 放进主 location,vod-backups.conf 是一串命名 location;没配时两个都是空文件。
: > "$SNIPPETS/vod-failover.conf"
: > "$SNIPPETS/vod-backups.conf"
set -f
set -- $(echo "${VITE_VOD_BACKUP_TARGETS:-}" | tr ',\r' '  ')
set +f
n=0
for target in "$@"; do
  case "$target" in
    http://*|https://*) ;;
    *) die "VITE_VOD_BACKUP_TARGETS 里的 $target 必须以 http:// 或 https:// 开头" ;;
  esac
  n=$((n + 1))
  rest=${target#*://}
  hostport=${rest%%/*}
  path=
  case "$rest" in */*) path=/${rest#*/} ;; esac
  path=${path%/}
  {
    echo "location @vod_backup_$n {"
    echo "    proxy_pass ${target%%://*}://$hostport$path\$uri\$is_args\$args;"
    echo "    proxy_ssl_name ${hostport%%:*};"
    echo "    proxy_set_header Host $hostport;"
    echo "    include $SNIPPETS/vod-common.conf;"
    if [ "$n" -lt "$#" ]; then
      echo "    proxy_intercept_errors on;"
      echo "    recursive_error_pages on;"
      echo "    error_page 404 500 502 503 504 = @vod_backup_$((n + 1));"
    fi
    echo "}"
  } >> "$SNIPPETS/vod-backups.conf"
done
if [ "$n" -gt 0 ]; then
  # 第一次转去备用地址时就要开 recursive_error_pages,否则备用地址再出错不会接着往下转。
  printf '%s\n' 'proxy_intercept_errors on;' 'recursive_error_pages on;' 'error_page 404 500 502 503 504 = @vod_backup_1;' \
    > "$SNIPPETS/vod-failover.conf"
  log "片库备用地址:$*"
fi

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
