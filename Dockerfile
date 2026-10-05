# VikingPilot — produksjonsbilde.
#
# Migreringer kjøres ikke her, men ved oppstart i scripts/start-prod.mjs.
# Det gjør at skjemaet setter seg selv opp mot en tom database, og at en
# feilende migrering stopper tjenesten i stedet for å gi en halvferdig base.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---------------------------------------------------------------------------
# Avhengigheter
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# postinstall kjører `prisma generate`, som leser prisma.config.ts. Den krever
# at DATABASE_URL finnes som variabel, men kobler ikke til databasen.
# Derfor en plassholder her — den ekte verdien settes av Railway ved kjøring.
ENV DATABASE_URL="postgresql://plassholder:plassholder@localhost:5432/plassholder"
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Bygg
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://plassholder:plassholder@localhost:5432/plassholder"

RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# Kjøring
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs
EXPOSE 3000

CMD ["node", "scripts/start-prod.mjs"]
