# syntax=docker/dockerfile:1
# video-website 两阶段构建。
#   builder: 按 BUILD_MODE(dev | test | pro) 执行 npm run build:<mode>
#   runner : nginx 托管 dist/，并把 /api-video-pomelo7-server/* 反代到片库
ARG NODE_IMAGE=node:20-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}"
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BUILD_MODE=pro
RUN npm run "build:${BUILD_MODE}"

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
 && mkdir -p /etc/nginx/ssl /etc/nginx/snippets /etc/nginx/templates /var/www/certbot
COPY docker/nginx/conf.d/ /etc/nginx/conf.d/
COPY docker/nginx/snippets/proxy-common.conf /etc/nginx/snippets/proxy-common.conf
COPY docker/nginx/templates-available/ /etc/nginx/templates-available/
COPY docker/nginx/10-video-website-select-templates.sh /docker-entrypoint.d/10-video-website-select-templates.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/10-video-website-select-templates.sh \
 && chmod +x /docker-entrypoint.d/10-video-website-select-templates.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
