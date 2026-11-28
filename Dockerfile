# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.25.0

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY next.config.ts tsconfig.json next-env.d.ts ./
COPY src ./src
COPY public ./public
COPY contracts/runtime ./contracts/runtime
# Static compilation requires no hosted database or server secret. Runtime validates APP_ENV.
RUN APP_ENV=test GIT_TUTOR_STANDALONE=1 pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24.22.1-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM node:24.22.1-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production WORKER_HEARTBEAT_FILE=/tmp/git-tutor-worker-heartbeat
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node contracts/runtime ./contracts/runtime
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "--import", "tsx", "src/worker/healthcheck.ts"]
CMD ["node", "--conditions=react-server", "--import", "tsx", "src/worker/index.ts"]
