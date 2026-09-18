# DEPLOY — my-cachifa-backend

Despliegue de la fase de prueba: **laptop personal + Docker + Cloudflare Tunnel**.
Todo corre en contenedores. Lo único que el equipo anfitrión necesita instalado
es **Docker** (con Docker Compose v2). No hace falta Node, pnpm, `psql` ni
Postgres nativo: el contenedor `app` trae dentro el CLI de Prisma y el
contenedor `postgres` trae `pg_dump`/`pg_restore`.

---

## 1. Arquitectura

Tres servicios en `docker-compose.prod.yml`, todos en la red `cachifa_network`:

| Servicio      | Imagen                          | Puerto en el host        | Rol |
| ------------- | ------------------------------- | ------------------------ | --- |
| `postgres`    | `postgres:16-alpine`            | **ninguno** (solo la red interna) | Datos, en el volumen nombrado `cachifa_postgres_data` |
| `app`         | build local `cachifa-backend:prod` | `127.0.0.1:3000` (solo loopback, para depurar) | API NestJS + cron de gastos fijos |
| `cloudflared` | `cloudflare/cloudflared:latest` | ninguno                  | Túnel saliente hacia Cloudflare; publica el dominio |

Detalles que importan:

- **Postgres no publica el puerto 5432 al host.** Solo `app` (y cualquier
  `docker compose exec`) lo alcanza por la red de Compose. Nada en la red WiFi
  local puede conectarse a la base de datos.
- **`app` escucha solo en `127.0.0.1:3000`.** El tráfico público entra por
  `cloudflared`, no por la interfaz de red de la laptop.
- **El volumen de Postgres es un volumen nombrado**, no un bind mount a una
  ruta de este equipo. Los datos no dependen de `/Users/...` ni de ninguna
  carpeta local, así que mover el despliegue a otra máquina es
  `pg_dump` → `pg_restore` (ver §5), sin copiar rutas ni permisos.
- `cloudflared` arranca con `depends_on: app: condition: service_healthy`: no
  publica el dominio hasta que la API responde el healthcheck.
- El healthcheck de `app` hace `GET http://localhost:3000/api/v1/health`, que es
  el **único endpoint sin `ApiKeyGuard`** (y con `@SkipThrottle()`), por lo que
  no necesita cabecera `X-API-Key`.

---

## 2. Requisitos previos

- Docker Desktop (o Docker Engine) corriendo en la laptop.
- Dominio contratado y agregado a Cloudflare (ya hecho).
- Un túnel creado en **Cloudflare Zero Trust → Networks → Tunnels**, tipo
  *Connector: Docker*, del que se copia el **token** (la cadena larga del
  comando `cloudflared ... run <TOKEN>` que muestra el panel).
- En ese túnel, una **Public Hostname** configurada así:

  | Campo    | Valor                          |
  | -------- | ------------------------------ |
  | Subdomain / Domain | tu dominio (ej. `api.tudominio.com`) |
  | Type     | `HTTP`                         |
  | URL      | `app:3000`                     |

  > Debe ser `app:3000` (el nombre del servicio en la red de Compose), **no**
  > `localhost:3000`: `cloudflared` corre en su propio contenedor, y para él
  > `localhost` es él mismo.

---

## 3. Checklist de arranque

### 3.1 Crear el `.env` de producción

En la raíz del repo, junto a `docker-compose.prod.yml`. Compose lo usa para dos
cosas: interpolar `${...}` en el YAML (credenciales de Postgres, token del
túnel) y como `env_file` del contenedor `app`.

```bash
# ─── App ─────────────────────────────────────────────
PORT=3000
NODE_ENV=production
API_KEY=<nueva, distinta a la de desarrollo>   # openssl rand -hex 32

# ─── Postgres ────────────────────────────────────────
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<contraseña nueva y larga>
POSTGRES_DB=cachifa_db

# El host es el nombre del contenedor de Postgres en la red de Compose.
# NO uses localhost aquí: desde el contenedor `app`, localhost es `app`.
DATABASE_URL=postgresql://postgres:<misma contraseña>@cachifa_db:5432/cachifa_db

# ─── Cloudflare Tunnel ───────────────────────────────
CLOUDFLARE_TUNNEL_TOKEN=<token del túnel en el panel de Cloudflare>

# ─── AI Provider ─────────────────────────────────────
AI_PROVIDER=gemini
GEMINI_API_KEY=<key>
# ANTHROPIC_API_KEY=<key>   # solo si AI_PROVIDER=anthropic

# ─── WhatsApp (pausado, pero obligatorio) ────────────
# La validación Joi de AppModule marca estas cinco como `required()`. Con
# WhatsApp en pausa igual deben existir o el contenedor NO arranca. Poner
# placeholders está bien mientras el canal siga apagado.
WA_PHONE_NUMBER_ID=placeholder
WA_ACCESS_TOKEN=placeholder
WA_VERIFY_TOKEN=placeholder
WA_WEBHOOK_SECRET=placeholder
MY_WA_NUMBER=+57XXXXXXXXXX
```

> ⚠️ **No copies `DATABASE_URL_LOCAL` al `.env` de producción.** `prisma/seed.ts`
> y `prisma/migrate-local.js` reescriben `DATABASE_URL` con ese valor si existe;
> dentro del contenedor eso apunta a `localhost:5432`, donde no hay nada, y el
> seed falla con *"Can't reach database server at localhost:5432"*.

> ⚠️ **No copies `API_KEY` de desarrollo.** La API queda expuesta a internet: la
> única barrera es esa clave (más el rate limit de 60 req/min por IP).

### 3.2 Levantar la pila

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Los tres servicios deben quedar `Up`, y `postgres` y `app` además `(healthy)`.

### 3.3 Aplicar migraciones

Siempre, tanto en base nueva como existente. Se corre **dentro** del contenedor
(el CLI de Prisma y las migraciones viajan en la imagen):

```bash
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate status
```

`migrate status` debe terminar en `Database schema is up to date!`.

### 3.4 Seed — SOLO si la base es nueva

> 🛑 **No corras el seed sobre una base con datos reales.** `prisma/seed.ts`
> hace `upsert` del usuario y **reescribe presupuestos, cuentas, metas y
> aportes** con los valores de ejemplo. Sobre datos financieros reales eso
> sobrescribe información sin posibilidad de deshacer.
>
> Antes de correrlo, verifica que la base esté vacía:
>
> ```bash
> docker compose -f docker-compose.prod.yml exec postgres \
>   psql -U postgres -d cachifa_db -c 'SELECT count(*) FROM "User";'
> ```
>
> Si devuelve `0`, es base nueva y el seed es seguro. Si devuelve cualquier otra
> cosa, **sáltate este paso.**

```bash
docker compose -f docker-compose.prod.yml exec app pnpm prisma db seed
```

### 3.5 Verificar

```bash
# Local (dentro de la laptop)
curl -s http://127.0.0.1:3000/api/v1/health          # → {"status":"ok"}

# Público, a través del túnel
curl -s https://<tu-dominio>/api/v1/health           # → {"status":"ok"}

# Con API key, para confirmar que el guard funciona
curl -s -H "X-API-Key: <API_KEY>" https://<tu-dominio>/api/v1/settings
```

La prueba que vale es la del dominio **desde datos móviles, con el WiFi de la
casa apagado**: confirma que el tráfico entra por Cloudflare y no por la red
local.

---

## 4. Operación diaria

```bash
# Logs
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f cloudflared

# Reiniciar solo la API
docker compose -f docker-compose.prod.yml restart app

# Apagar todo (los datos sobreviven en el volumen)
docker compose -f docker-compose.prod.yml down

# Desplegar cambios de código
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate deploy
```

> `down -v` **borra el volumen y con él todos los datos**. Nunca uses `-v` aquí
> sin un backup reciente (§5).

---

## 5. Backup manual

Esta es **la única copia de los datos financieros reales** mientras todo corre
en un solo equipo, sin réplica ni snapshots. Si el disco de la laptop falla, no
hay de dónde recuperar. Hacer el dump y **sacarlo de la laptop** es obligatorio,
no opcional.

### 5.1 Crear el dump

```bash
cd /ruta/al/repo/my-cachifa-backend

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d cachifa_db --clean --if-exists \
  > ~/backups/cachifa-$(date +%Y%m%d-%H%M).sql
```

- `exec -T` evita que Docker asigne un TTY y corrompa el archivo redirigido.
- `--clean --if-exists` hace el dump restaurable sobre una base que ya tenga
  tablas, sin tener que borrarla a mano antes.
- El comando corre `pg_dump` **dentro** del contenedor, así que no necesitas
  cliente de Postgres instalado en la laptop.

Comprimido, si el archivo empieza a crecer:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d cachifa_db --clean --if-exists \
  | gzip > ~/backups/cachifa-$(date +%Y%m%d-%H%M).sql.gz
```

### 5.2 Sacarlo de la laptop

Un dump que se queda en el mismo disco que la base **no es un backup**. Después
de crearlo, súbelo a un almacenamiento propio fuera del equipo — por ejemplo:

```bash
# rclone hacia un bucket / Drive / lo que uses
rclone copy ~/backups/cachifa-$(date +%Y%m%d)*.sql <remoto>:cachifa-backups/

# o scp a otra máquina
scp ~/backups/cachifa-*.sql usuario@otro-equipo:/backups/cachifa/
```

**Cadencia sugerida:** una vez por semana, y siempre antes de un `up -d --build`
que traiga migraciones nuevas. Conserva al menos los últimos 4 dumps: un backup
único también se corrompe.

### 5.3 Restaurar

```bash
# Sobre una base ya levantada (--clean se encarga de limpiar lo anterior)
cat ~/backups/cachifa-20260908-2100.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d cachifa_db

# Si el dump está comprimido
gunzip -c ~/backups/cachifa-20260908-2100.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d cachifa_db
```

Después de restaurar, confirma que el esquema está al día:

```bash
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate status
```

> Prueba la restauración al menos una vez, sobre una base de descarte
> (`POSTGRES_DB` distinto o un proyecto Compose aparte con `-p cachifa_test`).
> Un backup que nunca se restauró es una suposición, no un respaldo.

---

## 6. Limitación conocida y aceptada: disponibilidad

**Esta app deja de responder mientras la laptop esté apagada, suspendida o sin
internet.** Es una limitación conocida y aceptada durante esta fase de prueba.

Concretamente, mientras el equipo no esté encendido y conectado:

- El dominio devuelve error de Cloudflare (**1033 / 502**): no hay túnel activo.
- La app móvil no puede consultar ni registrar nada; todas las peticiones fallan.
- **El cron de recordatorios de gastos fijos no se ejecuta.** No se acumula ni se
  recupera: las ejecuciones que caían en ese rato simplemente no ocurren, y no
  se disparan al volver a encender. Si la laptop estuvo apagada el día en que
  tocaba el recordatorio de un gasto fijo, ese recordatorio no llega.
- Suspender la laptop (cerrar la tapa) tiene el mismo efecto que apagarla.

Esto se acepta a cambio de no pagar un VPS durante la prueba.

**Revisar tras 1 mes de uso** (desde 2026-09-08, es decir hacia el
**2026-10-08**) si se justifica migrar a un VPS pago. Señales de que sí:

- Se perdieron recordatorios de gastos fijos que importaban.
- Hubo que registrar un gasto desde la calle y la API no respondía.
- Mantener la laptop encendida se volvió una tarea en sí misma.

Si tras el mes nada de eso molestó, seguir en la laptop es la decisión correcta.

---

## 7. Migrar a un VPS más adelante

El despliegue está armado para que la migración sea copiar tres cosas y nada
más — no hay estado fuera de estos elementos:

1. El repo (o al menos `docker-compose.prod.yml` + `Dockerfile` + `prisma/`).
2. El archivo `.env` (ajustando `DATABASE_URL` si cambian las credenciales).
3. Un dump de Postgres hecho con §5.1.

En el VPS, con solo Docker instalado:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate deploy
cat cachifa-<fecha>.sql | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d cachifa_db
```

El túnel de Cloudflare se mueve solo: el mismo `CLOUDFLARE_TUNNEL_TOKEN`
funciona desde cualquier máquina. Levanta `cloudflared` en el VPS y apaga el de
la laptop; el DNS del dominio no se toca. **No corras los dos a la vez** con el
mismo token o Cloudflare balanceará entre ambos y las peticiones caerán en la
base equivocada.

---

## 8. Problemas frecuentes

| Síntoma | Causa probable |
| ------- | -------------- |
| `app` reinicia en bucle, logs con error de Joi (`"WA_ACCESS_TOKEN" is required`) | Falta alguna variable obligatoria en `.env`. Ver §3.1: las cinco `WA_*` son obligatorias aunque WhatsApp esté pausado |
| `Can't reach database server at localhost:5432` | `DATABASE_URL` apunta a `localhost` en vez de `cachifa_db`, o hay un `DATABASE_URL_LOCAL` colado en el `.env` de producción |
| El dominio da error 1033 | `cloudflared` no está corriendo, o la laptop está apagada/suspendida (§6) |
| El dominio da 502 pero `curl localhost:3000` funciona | La Public Hostname del túnel apunta a `localhost:3000` en vez de `app:3000` (§2) |
| `401 Unauthorized` en todo menos `/health` | Falta la cabecera `X-API-Key`, o el móvil quedó con la clave de desarrollo |
| `429 Too Many Requests` | Rate limit de 60 req/min por IP (`ThrottlerModule` en `app.module.ts`) |
