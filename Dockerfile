# =============================================================================
# AgriFortress — Docker image for Cloud Run
# Uses Next.js standalone output for a minimal, self-contained image.
# =============================================================================

FROM node:22-alpine AS base
RUN corepack enable

# ---------------------------------------------------------------------------
# 1. Install dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build emits .next/standalone when output: 'standalone' is set
RUN pnpm run build

# ---------------------------------------------------------------------------
# 3. Runtime — minimal image with only the standalone output
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run injects PORT; Next.js standalone server honours it.
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Standalone build + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
