# ─── Base Stage ──────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# ─── Development Stage ────────────────────────────────────
FROM base AS development

ENV NODE_ENV=development

CMD ["npm", "run", "start:dev"]

# ─── Build Stage (for production) ────────────────────────
FROM base AS build

RUN npm run build

# ─── Production Stage ─────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --only=production

COPY --from=build /app/dist ./dist

RUN addgroup -S cachifa && adduser -S cachifa -G cachifa

USER cachifa

CMD ["node", "dist/main"]
