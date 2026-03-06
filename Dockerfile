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

# Prisma 클라이언트 생성
RUN npx prisma generate

# Next.js 빌드
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma 클라이언트
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 11008
ENV PORT=11008
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
