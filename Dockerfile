# syntax=docker/dockerfile:1
# video-website 构建。
#   builder: 按 BUILD_MODE(dev | test | pro) 执行 npm run build:<mode>
#   njsmod : 编译 ngx_http_js_module，用来把片库校验的 850 改成 200
#   runner : nginx 托管 dist/，并把 /api-video-pomelo7-server/* 反代到片库
ARG NODE_IMAGE=node:20-alpine
# vod-upstream.conf 的 server … resolve 需要 nginx 1.27.3 及以上；固定版本，免得本机缓存的旧 1.27 镜像起不来。
ARG NGINX_IMAGE=nginx:1.27.5-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}"
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BUILD_MODE=pro
RUN npm run "build:${BUILD_MODE}"

FROM ${NGINX_IMAGE} AS njsmod
ARG ALPINE_APK_REPO_MIRROR=https://mirrors.aliyun.com
ARG NJS_VERSION=0.8.7
RUN set -eux; \
  cp /etc/apk/repositories /tmp/apk-official; \
  if [ -n "${ALPINE_APK_REPO_MIRROR}" ]; then \
    sed -i "s#https://dl-cdn.alpinelinux.org#${ALPINE_APK_REPO_MIRROR}#g" /etc/apk/repositories; \
  fi; \
  pkgs="gcc libc-dev make openssl-dev pcre2-dev zlib-dev linux-headers curl tar perl"; \
  if ! apk add --no-cache $pkgs; then \
    cp /tmp/apk-official /etc/apk/repositories; \
    apk add --no-cache $pkgs; \
  fi
RUN set -eux; \
  apk add --no-cache libxml2-dev libxslt-dev; \
  ver="$(nginx -v 2>&1 | sed -n 's|.*/||p')"; \
  mkdir -p /tmp/src /out; \
  curl -fL --retry 5 --retry-delay 2 -o /tmp/nginx.tar.gz "https://nginx.org/download/nginx-${ver}.tar.gz"; \
  tar -xzf /tmp/nginx.tar.gz -C /tmp/src; \
  njs_ok=0; \
  for url in \
    "https://codeload.github.com/nginx/njs/tar.gz/refs/tags/${NJS_VERSION}" \
    "https://github.com/nginx/njs/archive/refs/tags/${NJS_VERSION}.tar.gz"; \
  do \
    if curl -fL --retry 5 --retry-delay 2 -o /tmp/njs.tar.gz "$url"; then njs_ok=1; break; fi; \
  done; \
  [ "$njs_ok" -eq 1 ]; \
  tar -xzf /tmp/njs.tar.gz -C /tmp/src; \
  cd "/tmp/src/nginx-${ver}"; \
  ./configure --with-compat --add-dynamic-module="/tmp/src/njs-${NJS_VERSION}/nginx"; \
  make modules; \
  cp objs/ngx_http_js_module.so /out/ngx_http_js_module.so

FROM ${NGINX_IMAGE} AS runner
ARG ALPINE_APK_REPO_MIRROR=https://mirrors.aliyun.com
RUN set -eux; \
  if [ -n "${ALPINE_APK_REPO_MIRROR}" ]; then \
    sed -i "s#https://dl-cdn.alpinelinux.org#${ALPINE_APK_REPO_MIRROR}#g" /etc/apk/repositories; \
  fi; \
  apk update --no-cache \
  || ( sed -i 's|https://|http://|g' /etc/apk/repositories && apk update --no-cache ); \
  apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai \
    SERVER_NAME=_ \
    SSL_ENABLED=false \
    HTTPS_REDIRECT_PORT= \
    HSTS_HEADER=max-age=31536000
RUN rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/ssl /etc/nginx/snippets /etc/nginx/templates /etc/nginx/njs /usr/lib/nginx/modules /var/www/certbot \
 && sed -i '1i load_module /usr/lib/nginx/modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf
COPY --from=njsmod /out/ngx_http_js_module.so /usr/lib/nginx/modules/ngx_http_js_module.so
COPY docker/nginx/njs/vod.js /etc/nginx/njs/vod.js
COPY docker/nginx/conf.d/ /etc/nginx/conf.d/
COPY docker/nginx/snippets/proxy-common.conf /etc/nginx/snippets/proxy-common.conf
COPY docker/nginx/templates-available/ /etc/nginx/templates-available/
COPY docker/nginx/10-video-website-select-templates.sh /docker-entrypoint.d/10-video-website-select-templates.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-video-website-select-templates.sh /etc/nginx/njs/vod.js /etc/nginx/conf.d/vod-status.conf \
 && chmod +x /docker-entrypoint.d/10-video-website-select-templates.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
