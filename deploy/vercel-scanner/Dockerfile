# syntax=docker/dockerfile:1
# Vercel Daemons run Linux amd64. Pin both runtime images to their amd64 manifests.
FROM node:24.22.1-alpine@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420 AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM clamav/clamav:1.4.7@sha256:e852c9a5cb14d39edb1b6ceb0eb7cd1dc220daa0418ac0261087c55d22c00a55
WORKDIR /app
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
# Keep Node's matching Alpine C++ runtime private to the supervisor and worker.
COPY --from=dependencies /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /opt/git-tutor-node-libs/
ENV LD_LIBRARY_PATH=/opt/git-tutor-node-libs
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY contracts/runtime ./contracts/runtime
COPY deploy/vercel-scanner/clamd.conf deploy/vercel-scanner/freshclam.conf /etc/clamav/
COPY deploy/vercel-scanner/supervise.mjs ./
RUN addgroup -g 1100 gitworker && adduser -D -u 1100 -G gitworker gitworker \
    && mkdir -p /app/.local && chown gitworker:gitworker /app/.local && chown clamav:clamav /var/lib/clamav \
    && node --version && clamd --version && freshclam --version
ENV NODE_ENV=production TZ=UTC FILE_SCAN_ADAPTER=clamav FILE_SCAN_URL=tcp://127.0.0.1:3310 \
    WORKER_HEARTBEAT_FILE=/tmp/git-tutor-worker-heartbeat
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 CMD ["node", "--import", "tsx", "src/worker/healthcheck.ts"]
ENTRYPOINT ["node", "--conditions=react-server", "--import", "tsx", "/app/supervise.mjs"]
CMD []
