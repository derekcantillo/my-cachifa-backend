# my-cachifa-backend

API REST de **Cachifa**, un sistema de finanzas personales de un solo usuario (moneda COP, hora de Bogotá). La consumen `my-cashifa-web` y `MyCachifaMobile`. Organiza el dinero en **períodos financieros** que abre cada salario, y a partir de ellos calcula presupuestos, ledger, reportes, metas, préstamos y patrimonio neto.

## Stack

NestJS 11 sobre Fastify · TypeScript strict · Prisma 6 + PostgreSQL 16 · class-validator · Joi (validación del `.env`) · `@nestjs/schedule` (cron de gastos fijos) · `@nestjs/throttler` (60 req/min) · Gemini o Anthropic para clasificar mensajes de WhatsApp (canal en pausa).

## Requisitos

- Node 22 y pnpm (vía `corepack enable`)
- Docker y Docker Compose (para Postgres)

## Setup local

```bash
pnpm install
cp .env.example .env          # completa los valores; nunca los subas al repo
docker compose up -d postgres
pnpm prisma:migrate           # usa DATABASE_URL_LOCAL
pnpm start:dev                # http://localhost:3000/api/v1
```

`DATABASE_URL` apunta al contenedor (`postgres`), no a `localhost`. Para correr `pnpm start:dev` desde el host, ese valor tiene que usar `localhost:5432`; otra opción es levantar todo con `docker compose up app`. Las variables de WhatsApp son obligatorias para arrancar aunque el canal esté en pausa (sirven valores de relleno). `pnpm prisma:seed` carga datos de ejemplo.

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm start:dev` | Servidor con recarga |
| `pnpm build` / `pnpm start:prod` | Compila a `dist/` y lo ejecuta |
| `pnpm lint` | ESLint **con `--fix`** (modifica archivos) |
| `pnpm test` / `pnpm test:cov` | Tests unitarios (`src/**/*.spec.ts`) / con cobertura |
| `pnpm test:e2e` | Tests e2e (`test/`) |
| `pnpm prisma:migrate` / `pnpm prisma:seed` | Migraciones / seed contra la base local |
| `npx tsc --noEmit` | Revisión de tipos sin compilar |

## Módulos (`src/modules`)

accounts · admin · ai · alerts · budget-rules · budgets · **expenses** (CRUD de transacciones) · financial-periods · goals · health · loans · net-worth · period-ledger · prisma · recurring-expenses · reports · settings · whatsapp. Lo compartido (guard de API key, filtros, pipes, utilidades de período y moneda) está en `src/common`.

## Endpoints principales

Todo va bajo `/api/v1` y exige el header `X-API-Key`, salvo `GET /health` (público) y `/webhook` (sin prefijo, firmado con HMAC). Donde aplica, `?periodId=` elige el período; si se omite, se usa el actual.

| Recurso | Endpoints |
|---|---|
| Salud | `GET /health` |
| Períodos | `GET /financial-periods`, `GET /financial-periods/current` |
| Transacciones | `GET /transactions?periodId=`, `GET/PATCH/DELETE /transactions/:id`, `POST /transactions` |
| Presupuestos | `GET/PUT /budgets?periodId=`, `POST /budgets/:periodId/reset`, `POST /budgets/:periodId/recalculate` |
| Reglas de presupuesto | `GET/PUT /budget-rules` |
| Ledger del período | `GET /period-ledger?periodId=`, `POST /period-ledger/:periodId/recalculate` |
| Gastos fijos | `GET/POST /recurring-expenses`, `GET /recurring-expenses/pending`, `PATCH/DELETE /recurring-expenses/:id` |
| Metas | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`, `POST /goals/:id/contributions` |
| Préstamos | `GET/POST /loans`, `GET/PATCH/DELETE /loans/:id`, `POST /loans/:id/repayments` |
| Cuentas | `GET/POST /accounts`, `PATCH /accounts/:id/initial-balance` |
| Reportes | `GET /reports/summary`, `GET /reports/distribution`, `GET /reports/savings-projection` |
| Alertas | `GET /alerts?unreadOnly=`, `GET /alerts/unread-count`, `PATCH /alerts/:id/read`, `POST /alerts/read-all` |
| Patrimonio y ajustes | `GET /net-worth`, `GET/PATCH /settings` |
| Admin | `POST /admin/migrate-periods` |
| WhatsApp | `GET /webhook` (verificación), `POST /webhook` (mensajes) |

## Tests

```bash
pnpm test        # unitarios, no necesitan base de datos
pnpm test:e2e    # levanta HealthModule sobre Fastify; tampoco necesita base de datos
```

Antes de cerrar un cambio conviene correr `pnpm lint`, `pnpm test` y `npx tsc --noEmit`.

## Más documentación

- [DEPLOY.md](./DEPLOY.md): despliegue con Docker Compose y Cloudflare Tunnel, y backup manual.
- [CLAUDE.md](./CLAUDE.md): contexto del proyecto, reglas de negocio y convenciones.
