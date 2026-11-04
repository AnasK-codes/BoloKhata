# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/gateway/Dockerfile .
# Multi-arch note: the base image is multi-arch, so the same file builds for x86_64 (t3) and
# arm64 (t4g): build on the target machine, or `docker buildx build --platform linux/arm64 ...`.

ARG NODE_VERSION=22
ARG PNPM_VERSION=12.16.1

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@bolbill/gateway..." \
 && pnpm --filter @bolbill/gateway build \
 && pnpm --filter @bolbill/gateway --prod deploy --legacy /out \
 && cp -r apps/gateway/dist /out/dist

FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production \
    PORT=8080 \
    GNANI_TTS_CACHE_DIR=/data/tts-cache
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The phrase cache lives on a volume so it survives restarts; the node user must own it.
RUN mkdir -p /data/tts-cache && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# SIGTERM starts the graceful drain (see src/main.ts); `init: true` in compose reaps children.
CMD ["node", "dist/main.js"]
