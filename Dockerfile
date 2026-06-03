# ─── Base Stage ───────────────────────────────────────────────
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

# ─── Development Stage ────────────────────────────────────────
FROM base AS development

ENV NODE_ENV=development

CMD ["pnpm", "run", "start:dev"]

# ─── Build Stage ──────────────────────────────────────────────
FROM base AS build

RUN pnpm run build

# ─── Production Stage ─────────────────────────────────────────
FROM node:22-alpine AS production

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

RUN addgroup -S cachifa && adduser -S cachifa -G cachifa

USER cachifa

CMD ["node", "dist/main"]
