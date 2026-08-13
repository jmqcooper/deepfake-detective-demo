FROM python:3.12-bookworm AS sample-pack
WORKDIR /src
ARG FORCE_SYNTHETIC_SAMPLES=0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir numpy==2.4.2 Pillow==12.3.0
COPY tools/make_synthetic_dutch_fixture.py tools/prepare_samples.py ./tools/
COPY web/public/samples/ /provided/
RUN mkdir -p /out \
    && if [ "$FORCE_SYNTHETIC_SAMPLES" = "1" ] || [ ! -f /provided/manifest.json ]; then \
      python tools/make_synthetic_dutch_fixture.py --out /tmp/fixture \
      && python tools/prepare_samples.py --cache /tmp/fixture --out /out; \
    else \
      cp -a /provided/. /out/; \
    fi \
    && python tools/prepare_samples.py --out /out --verify-only

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY web/package.json web/package-lock.json ./
RUN npm ci \
    && npm rebuild better-sqlite3 --build-from-source

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY web/ .
COPY --from=sample-pack /out ./public/samples
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/stats.db \
    STATS_DRIVER=sqlite \
    TZ=Europe/Amsterdam \
    REPORT_TIMEZONE=Europe/Amsterdam

RUN mkdir -p /app/data /app/backups \
    && chown node:node /app/data /app/backups

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node ops/stats-maintenance.mjs ./ops/stats-maintenance.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
