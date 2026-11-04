# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/web/Dockerfile \
#   --build-arg NEXT_PUBLIC_GATEWAY_URL=https://your.domain .
# NEXT_PUBLIC_GATEWAY_URL is baked into the client bundle at build time (it is a URL, not a
# secret). Changing the domain means rebuilding this image.

ARG NODE_VERSION=22
ARG PNPM_VERSION=12.16.1

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
ARG NEXT_PUBLIC_GATEWAY_URL
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@bolbill/web..." \
 && pnpm --filter @bolbill/web build

FROM node:${NODE_VERSION}-alpine AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Next's standalone output keeps the monorepo layout: the server is apps/web/server.js.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
