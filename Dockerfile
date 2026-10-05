# VikingPilot — produksjonsbilde.
#
# Migreringer OG grunndata kjøres ikke her, men ved oppstart i
# scripts/start-prod.mjs. Det gjør at systemet setter seg selv opp mot en tom
# database, og at en feilende migrering stopper tjenesten i stedet for å gi en
# halvferdig base.
#
# NODE 22, IKKE 20 — og grunnen er ikke tilfeldig:
# Den genererte Prisma-klienten er TypeScript-filer, og Prisma 7 genererer dem
# ikke som JavaScript. Uten tsx (som er en utvikleravhengighet og ikke finnes i
# dette bildet) må Node selv kunne lese dem. Det kan Node fra 22.6 med
# --experimental-strip-types, og fra 22.18 uten flagg. Node 20 kan det ikke.
# Prøvd: klienten lastes av ren Node 24 uten flagg. Se docs/status.md.
FROM node:22-alpine AS base
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

# Den genererte Prisma-klienten MÅ med. Den ligger i src/generated, ikke i
# node_modules, og uten den kan ikke oppstartsjobben sette opp grunndata.
# Den ble glemt i første versjon av dette bildet.
COPY --from=builder /app/src/generated ./src/generated

# passord.ts MÅ også med, og av en mindre opplagt grunn:
# `grunndata.mjs` importerer den for å hashe ADMIN_PASSWORD med NØYAKTIG samme
# funksjon som innloggingen bruker. Uten filen feiler brukeropprettingen med
# «Cannot find module '/app/src/lib/auth/passord.ts'».
#
# Dette var en regresjon jeg selv innførte: fram til ADMIN-variablene ble lagt
# til, importerte ikke grunndata.mjs noen TypeScript-filer i det hele tatt.
#
# Filen importerer bare `node:crypto` og `node:util`, altså rene innebygde
# moduler. Derfor er det nok å kopiere denne ene filen — vi trenger ikke hele
# src/lib, og vi vil ikke ha den med.
COPY --from=builder /app/src/lib/auth/passord.ts ./src/lib/auth/passord.ts

USER nextjs
EXPOSE 3000

CMD ["node", "scripts/start-prod.mjs"]
