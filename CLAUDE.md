# CLAUDE.md — my-cachifa-backend

API de **Cachifa**, sistema de finanzas personales de un solo usuario (Derek). La consume `my-cashifa-web` (prioridad actual) y `MyCachifaMobile` (en pausa). Los tres repos son hermanos dentro de `my-cachifa/` (la raíz no es repo git).

## Comandos
- `pnpm install` · `pnpm start:dev` · `pnpm build` (`nest build`) · `pnpm start:prod`
- `pnpm lint` (**trae `--fix`**: modifica archivos) · `pnpm test` (jest, specs en `src/**/*.spec.ts`) · `pnpm test:e2e` (solo levanta `HealthModule`; no necesita base de datos)
- `npx tsc --noEmit` para revisar tipos sin compilar
- `pnpm prisma:migrate` (usa `.env`, `DATABASE_URL_LOCAL`) · `pnpm prisma:seed`
- `DATABASE_URL` de `.env.example` apunta al host `postgres` (el contenedor). Para `pnpm start:dev` desde la máquina local hay que usar `localhost:5432`, o levantar `docker compose up app`.
- ⚠️ En este laptop **no hay base de desarrollo aparte**: el único Postgres que corre es `cachifa_db` de `docker-compose.prod.yml`, publicado en `127.0.0.1:5432`, y `docker-compose.yml` usa el mismo `container_name` y el mismo volumen. `DATABASE_URL_LOCAL` (y por tanto `pnpm prisma:migrate`, que es `migrate dev`) apunta a **producción**. Para probar migraciones, usar un Postgres desechable en otro puerto (p. ej. `docker run --rm -d --name cachifa_scratch_db -p 127.0.0.1:55432:5432 ...`) y pasar su `DATABASE_URL` por el entorno.
- Antes de cerrar un cambio: lint + `pnpm test` + `npx tsc --noEmit`.

## Stack
NestJS 11 + Fastify, TypeScript strict, Prisma 6, PostgreSQL 16, Joi (validación de env en `app.module.ts`), class-validator, `@nestjs/schedule` (cron de gastos fijos), `@nestjs/throttler` (60 req/min global). IA: Gemini primario, Anthropic alternativo, vía `AI_PROVIDER` (`src/modules/ai`). Alias: `@modules/*`, `@common/*`, `@config/*`.

## Estructura
- `src/modules/`: accounts, admin, ai, alerts, budget-rules, budgets, **expenses** (aquí vive el CRUD de transacciones), financial-periods, goals (+`lib/goal-plan.ts`), health, loans, net-worth, period-ledger, prisma, recurring-expenses, reports, settings, whatsapp.
- `src/common/`: `guards/api-key.guard.ts`, filters, interceptors, pipes, `utils/` (period, currency, percentage; `month.util.ts` es legado).
- `prisma/`: `schema.prisma`, `migrations/` (nunca editar una ya aplicada), `seed.ts`.
- `main.ts`: prefijo global `api/v1` (excluye `webhook`), CORS en `config/cors.config.ts`, `fastify-raw-body` global (HMAC de WhatsApp).

## Despliegue
Laptop de Derek como servidor, Docker Compose (`docker-compose.prod.yml`: postgres, app, cloudflared) + Cloudflare Tunnel. Dominio: `https://api.derekcantillo.com/api/v1`. Disponible solo si el laptop está encendido. Detalle y backup manual en `DEPLOY.md`. Migración a VPS (Hetzner CX22) sin decidir.

## Seguridad
- Todo bajo `api/v1` exige `ApiKeyGuard` (header de API key, `timingSafeEqual`) salvo `GET /health`. WhatsApp usa HMAC propio.
- La API key y los tokens van solo en `.env`; nunca en chat, commits ni logs. `.env.example` solo lleva nombres.

## Reglas de negocio (no cambiar sin preguntar)
- **Períodos financieros:** cada transacción `SALARY` abre un período (un salario al mes, penúltimo día hábil). Una transacción pertenece al período donde cae su `transactionDate` en `[startDate, endDate)`. Días en hora Bogotá (UTC-5 fijo). Servicio: `FinancialPeriodService`.
- **Presupuesto:** `budgetBase = openingBalance + ingresos del período − gastos fijos (RecurringExpense)`. Nunca usa `closingBalance` ni resta lo ya gastado. Categoría con gasto fijo → límite = `estimatedAmount`; con `BudgetRule` → `max(0, budgetBase) × targetPercentage/100`. Si `budgetBase < 0`: límites porcentuales en 0 y alerta de déficit.
- **Rollover:** el `closingBalance` de un período es el `openingBalance` del siguiente; `recalculateLedgerCascade` recalcula hacia adelante.
- `LOAN_GIVEN` y `LOAN_REPAYMENT` no cuentan como ingreso ni en presupuestos.
- **Préstamos (modelo):** cada `Loan` tiene una `Transaction` `LOAN_GIVEN` (`loanId`) y cada `LoanRepayment` su `Transaction` `LOAN_REPAYMENT` (`Transaction.loanRepaymentId`, único, `onDelete: Cascade`: borrar el abono borra su movimiento). Abonos viejos sin pareja quedan con el vínculo en `null` (ver `prisma/verify-loan-repayment-links.sql`). Esos movimientos solo se crean, editan y borran desde `/loans`: `/transactions` rechaza crearlos (400) y editarlos o borrarlos (409). `loanDate` no puede ser posterior al primer abono, comparando por día de Bogotá.
- **Aporte mensual por meta:** el backend es la única fuente (`plan` en `GET /goals`, `goals/lib/goal-plan.ts`). Los clientes no lo recalculan.
- Ahorro objetivo: 30 % del ingreso discrecional (configurable en Settings).
- `monthYear` y `budgetPeriod` de `Transaction` están **deprecados**: no usarlos en lógica nueva (aún aparecen en `transactions.service.ts`, `loans.service.ts`, DTOs y respuesta).
- Categorías: FOOD, TRANSPORT, ENTERTAINMENT, SERVICES, DEBT, HOUSING, VEHICLE, HEALTH, SAVING, SALARY, CONTINGENCY, LOAN, OTHER, EDUCATION, TAXES, PERSONAL.

## Convenciones
- Archivos y carpetas en inglés; código y comentarios en inglés; explicaciones a Derek en español (su inglés es B2, sin tecnicismos densos).
- Commits pequeños, un cambio lógico por commit, mensajes tipo `fix:`/`chore:`/`feat:`. No hacer `push` sin que Derek lo pida.
- Decisiones cerradas no se reabren sin que Derek lo pida.

## Estado (2026-11-03)
- **Bloque A hecho (en `main`):** error de lint de `main.ts` (import ES de `fastify-raw-body`), módulo `anthropic/` vacío eliminado, `platform-express` retirado, boilerplate de `app.controller/service` borrado y e2e reescrito para `/health`, bug `?unreadOnly=false` corregido con test, comentario de `periodId` en el schema, README real.
- **Bloque B hecho (en `main`, sin push):** `recurringExpenseId` en el PATCH de transacciones (y revalidación al cambiar categoría), bloqueo de movimientos de préstamo en `/transactions`, PATCH `/loans/:id` con `amount`/`loanDate`/`accountId`, `DELETE /loans/:id/repayments/:repaymentId`, vínculo abono ↔ transacción (migración `20261103165922_link_loan_repayment_transactions`), orden de fechas préstamo/abono, cascada cuando un movimiento de préstamo rehace los períodos.
- **Pendiente:** aplicar en producción la migración `20261103165922_link_loan_repayment_transactions` y correr `prisma/verify-loan-repayment-links.sql`; backup automático fuera del laptop (último dump 2026-09-18), doble conteo de metas en `/net-worth`, retirar `monthYear`/`budgetPeriod`, tests de servicios clave (ya hay specs de transactions y loans; faltan ledger, períodos y budgets).
- **Fase 2:** modelos `Debt` y `CreditCard` (hoy `net-worth.service.ts` deja deudas y tarjetas en 0; `DEBT_PAYMENT` existe sin modelo), bot de WhatsApp (clasifica con IA pero no guarda la transacción).
