# ===========================================
# RAG Collector - Docker 이미지
# ===========================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile || pnpm install

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# pnpm install 재확인 (prisma 빌드 바이너리 다운로드)
RUN pnpm install

# Prisma 클라이언트 생성
RUN pnpm exec prisma generate

# 옵셔널 DB 드라이버 stub (빌드 시 resolve용, 런타임에 dynamic import)
RUN mkdir -p node_modules/oracledb node_modules/pg node_modules/mysql2 && \
    echo "module.exports = {}" > node_modules/oracledb/index.js && \
    echo "module.exports = {}" > node_modules/pg/index.js && \
    echo "module.exports = { createConnection: () => {} }" > node_modules/mysql2/promise.js && \
    echo "module.exports = {}" > node_modules/mysql2/index.js

# Next.js 빌드
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

# git (GIT_CLONE 수집기), libreoffice (PPT 멀티모달)
RUN apk add --no-cache git libreoffice poppler-utils

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

EXPOSE 11009
ENV PORT=11009
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
