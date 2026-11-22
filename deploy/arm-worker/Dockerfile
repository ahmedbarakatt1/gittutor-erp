# syntax=docker/dockerfile:1
# Only architecture-independent signed definitions are copied from this image.
FROM --platform=linux/amd64 clamav/clamav:1.4.7@sha256:e852c9a5cb14d39edb1b6ceb0eb7cd1dc220daa0418ac0261087c55d22c00a55 AS signatures

FROM node:24.22.1-bookworm-slim@sha256:932a44adcdb8f5dfbf00f00eb38da8d22b450b2ad258b6d1b2319beca823bfbd AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM clamav/clamav:stable-debian13-slim@sha256:0470bfdde27380e21e196dd631a66a893729744843c077a460f80510de8bedbd
WORKDIR /app
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=signatures --chown=clamav:clamav /var/lib/clamav/ /var/lib/clamav/
COPY package.json tsconfig.json ./
COPY src ./src
COPY contracts/runtime ./contracts/runtime
COPY deploy/vercel-scanner/clamd.conf deploy/vercel-scanner/freshclam.conf /etc/clamav/
COPY deploy/vercel-scanner/supervise.mjs ./
RUN useradd --system --uid 1100 --user-group --create-home gitworker \
    && install -d -o gitworker -g gitworker /app/.local \
    && node --version && clamd --version && freshclam --version
ENV NODE_ENV=production TZ=UTC FILE_SCAN_ADAPTER=clamav FILE_SCAN_URL=tcp://127.0.0.1:3310 \
    WORKER_HEARTBEAT_FILE=/tmp/git-tutor-worker-heartbeat
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 CMD ["setpriv", "--reuid=gitworker", "--regid=gitworker", "--clear-groups", "node", "--import", "tsx", "src/worker/healthcheck.ts"]
ENTRYPOINT ["node", "--conditions=react-server", "--import", "tsx", "/app/supervise.mjs"]
CMD []
