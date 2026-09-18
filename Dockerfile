# ─── Base Stage ───────────────────────────────────────────────
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prisma generate

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
# Bake the corepack cache into the image instead of leaving it in root's home:
# the container runs as `cachifa`, and without this every `docker compose exec
# app pnpm ...` (migrate deploy, seed) would re-download pnpm from the network.
ENV COREPACK_HOME="/pnpm/corepack"

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Full install on purpose (no --prod): the Prisma CLI is a devDependency, but
# the container has to be able to run `prisma migrate deploy` / `db seed` by
# itself. That way the host only ever needs Docker — no Node, pnpm or psql.
RUN pnpm install --frozen-lockfile --prod=false

# Schema + migrations travel inside the image so the same image can migrate any
# database it is pointed at (laptop today, VPS tomorrow).
COPY prisma ./prisma

RUN pnpm prisma generate

COPY --from=build /app/dist ./dist

RUN addgroup -S cachifa && adduser -S cachifa -G cachifa

USER cachifa

CMD ["node", "dist/main"]
