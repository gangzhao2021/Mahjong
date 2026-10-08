# Game server + admin dashboard. Build from the repository root:
#   docker build -t mahjong-server .
# The mobile app is not part of this image (it is built with EAS).

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
# Only the server, the admin dashboard and the shared packages they use.
RUN pnpm install --frozen-lockfile --filter "@mahjong/server..." --filter "@mahjong/admin..."
RUN pnpm --filter @mahjong/admin build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8787
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/server
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
