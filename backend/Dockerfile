# ── Build stage: compile TypeScript inside the image ─────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# prisma (CLI for `migrate deploy` on boot) is a runtime dependency already.
# typescript powers the autofix patched-file syntax gate — without it the
# gate degrades to a skipped check, so install it pinned to package.json.
RUN npm ci --omit=dev \
  && npm i --no-save typescript@"$(node -p "require('./package.json').devDependencies.typescript")"

COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000

# Apply pending migrations, then start. DIRECT_URL (if set) is used for the
# migration connection; the app uses the pooled DATABASE_URL.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
