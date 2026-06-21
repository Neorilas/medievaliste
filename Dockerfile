# syntax=docker/dockerfile:1.7
# Build multi-stage para Next.js 16 (output: standalone) — Asentamiento.
# Imagen final pequeña, solo lo que pisa producción.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -qq && apt-get install -qq -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Stage 1: deps con caché (sin postinstall: prisma generate va en el builder).
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --prefer-offline

# Stage 2: build de Next.js (genera el cliente Prisma en lib/generated/prisma).
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: runner con solo lo necesario.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Cliente Prisma generado (output custom lib/generated/prisma): garantizar que
# esté en runtime aunque el tracing de Next no lo arrastre.
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated/prisma ./lib/generated/prisma
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
