# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts is frozen into the standalone server at build time: the public URL has to be known
# here for Server Actions to accept requests from it (see docker-compose.yml). Rebuild after changing it.
ARG OPSWATCH_PUBLIC_URL=
ENV OPSWATCH_PUBLIC_URL=${OPSWATCH_PUBLIC_URL}
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    OPSWATCH_DATA_DIR=/data

RUN groupadd --system --gid 1001 opswatch \
  && useradd --system --uid 1001 --gid opswatch --create-home --home-dir /home/opswatch opswatch \
  && mkdir -p /data && chown opswatch:opswatch /data

COPY --from=build --chown=opswatch:opswatch /app/.next/standalone ./
COPY --from=build --chown=opswatch:opswatch /app/.next/static ./.next/static
COPY --from=build --chown=opswatch:opswatch /app/public ./public
COPY --from=build --chown=opswatch:opswatch /app/drizzle ./drizzle
# Native modules: copied whole so their prebuilt binaries are present whatever the tracer kept.
# better-sqlite3 13 loads its own prebuilds and has no runtime dependency (node-addon-api is build-time only).
COPY --from=deps --chown=opswatch:opswatch /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=opswatch:opswatch /app/node_modules/@node-rs ./node_modules/@node-rs

USER opswatch
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/en/getting-started').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
