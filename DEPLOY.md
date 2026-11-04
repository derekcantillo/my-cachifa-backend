# DEPLOY — my-cachifa-backend

Despliegue de la fase de prueba: **laptop personal + Docker + Cloudflare Tunnel**.
Todo corre en contenedores. Lo único que el equipo anfitrión necesita instalado
es **Docker** (con Docker Compose v2). No hace falta Node, pnpm, `psql` ni
Postgres nativo: el contenedor `app` trae dentro el CLI de Prisma y el
contenedor `postgres` trae `pg_dump`/`pg_restore`.

---

## 1. Arquitectura

Cuatro servicios en `docker-compose.prod.yml`, todos en la red `cachifa_network`:

| Servicio      | Imagen                          | Puerto en el host        | Rol |
| ------------- | ------------------------------- | ------------------------ | --- |
| `postgres`    | `postgres:16-alpine`            | **ninguno** (solo la red interna) | Datos, en el volumen nombrado `cachifa_postgres_data` |
| `app`         | build local `cachifa-backend:prod` | `127.0.0.1:3000` (solo loopback, para depurar) | API NestJS + cron de gastos fijos |
| `cloudflared` | `cloudflare/cloudflared:latest` | ninguno                  | Túnel saliente hacia Cloudflare; publica el dominio |
| `backup`      | build local `cachifa-backup:prod` (`backup/`) | ninguno | Dump diario cifrado hacia B2/Drive con rclone (§5) |

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

### 4.1 Probar una migración sobre una copia antes de desplegarla

En este laptop **no hay base de desarrollo**: el Postgres de `127.0.0.1:5432`
(y `DATABASE_URL_LOCAL`, y el `docker-compose.yml` de desarrollo, que usa el
mismo contenedor y el mismo volumen) es **producción**. Nunca corras
`pnpm prisma:migrate` (es `migrate dev`, que puede borrar datos) contra ella
desde el host. Para probar una migración nueva:

```bash
scripts/test-migration-on-copy.sh                 # deja la copia arriba hasta que pulses Enter
scripts/test-migration-on-copy.sh -- <comando>    # corre <comando> contra la copia y limpia
scripts/test-migration-on-copy.sh --no-api -- true  # solo la migración, sin levantar la API
```

1. Saca un `pg_dump` de producción en sesión de **solo lectura**
   (`default_transaction_read_only=on`) a una carpeta temporal privada.
2. Lo carga en un Postgres desechable (`cachifa_migration_copy`,
   `127.0.0.1:55432`, contraseña aleatoria).
3. Aplica ahí las migraciones pendientes (`prisma migrate deploy`) y muestra
   `migrate status` antes y después.
4. Compila la API y la levanta contra la copia en `127.0.0.1:3001`, con una API
   key aleatoria y sin credenciales de WhatsApp. El comando (o tu otra terminal)
   recibe `COPY_DATABASE_URL`, `COPY_API_URL`, `COPY_API_KEY` y `COPY_API_LOG`:

   ```bash
   scripts/test-migration-on-copy.sh -- sh -c \
     'curl -s -H "X-API-Key: $COPY_API_KEY" "$COPY_API_URL/accounts"'
   ```

5. Al terminar (también si algo falla o con Ctrl-C) apaga la API, borra el
   contenedor y el volcado, y vuelve a volcar producción: si no es idéntico al
   primer volcado, avisa con las filas por tabla de antes y después y termina
   con error. Producción solo cambia si la API real (cron o peticiones) escribió
   mientras tanto.

Los puertos se cambian con `COPY_DB_PORT` y `COPY_API_PORT` (el script se niega
a usar 5432 y 3000). Para comparar con el código anterior, córrelo desde un
`git worktree` del commit viejo (con `node_modules` y `.env` enlazados) y
`COMPOSE_PROJECT_NAME=my-cachifa-backend`: Compose nombra el proyecto por la
carpeta. Probar en la copia no reemplaza el backup verificado del
mismo día antes del `migrate deploy` real (§5,
`docs/design-liabilities.md` G.1).

---

## 5. Backups

Esta es **la única copia de los datos financieros reales**. El servicio `backup`
hace un dump diario, lo verifica, lo **cifra** y lo sube fuera del equipo. Lo
mismo funciona igual en la laptop o en un VPS: solo depende de Docker y de un
archivo `rclone.conf` en el host.

### 5.1 Cómo funciona

| Qué | Cómo |
| --- | ---- |
| Cuándo | Todos los días a las **03:00 America/Bogota** (`BACKUP_TIME`). Si a esa hora la laptop estaba dormida o apagada, corre en cuanto el contenedor vuelva a estar arriba ese mismo día. Nunca más de una vez al día. |
| Qué hace | `pg_dump --clean --if-exists` de `cachifa_db`, comprimido con gzip. |
| Verificación | `gzip -t`, archivo no vacío, la marca `PostgreSQL database dump complete` al final del dump, y que el tamaño en el remoto coincida tras la subida. |
| Dónde | Local: volumen `cachifa_backups` (últimos **7**). Remoto: `daily/` (**7**), `weekly/` los domingos (**4**), `monthly/` el día 1 (**6**). |
| Cifrado | El remoto es de tipo **`crypt`** de rclone sobre Backblaze B2 o Google Drive: nombres y contenido van cifrados, el proveedor solo ve basura. |
| Si falla | Error en los logs y hasta **3 reintentos, una hora entre cada uno**. Si los 4 intentos fallan, vuelve a intentarlo al día siguiente. |
| Estado | `/status/last_backup.json` (volumen `cachifa_backup_status`): fecha, archivo, tamaño, resultado, error y la fecha del último backup correcto. |

El código está en `backup/` (`Dockerfile` + `backup.sh`). La config de rclone
**nunca** va dentro de la imagen ni del repo: se monta en solo lectura desde
`~/.config/cachifa-backup/` del host (`BACKUP_RCLONE_CONFIG_DIR` para cambiarla).

### 5.2 Configurar rclone (una sola vez)

> ⚠️ **La contraseña del remoto `crypt` (y su *salt*, `password2`) es lo único
> que permite leer los backups.** Si se pierde, todos los backups quedan
> **ilegibles para siempre**: ni Backblaze ni Google pueden recuperarlos.
> Guárdala en un **gestor de contraseñas** en el momento de crearla, junto con
> una copia completa del `rclone.conf`. Sin eso no hay backup.

Se configura con la misma imagen del servicio, así que no hace falta instalar
rclone en el host. Primero construye la imagen y crea la carpeta:

```bash
cd /ruta/al/repo/my-cachifa-backend
docker compose -f docker-compose.prod.yml build backup
mkdir -p ~/.config/cachifa-backup && chmod 700 ~/.config/cachifa-backup
```

**Opción A — Backblaze B2 (recomendada: llaves fijas, sin OAuth).**

1. En backblaze.com: crea un bucket **privado** (ej. `cachifa-backups`) y una
   *Application Key* limitada a ese bucket con permisos de lectura y escritura.
   Anota `keyID` y `applicationKey`.
2. Abre el asistente de rclone:

   ```bash
   docker run --rm -it --entrypoint rclone \
     -v ~/.config/cachifa-backup:/config/rclone \
     cachifa-backup:prod config
   ```

3. `n` (nuevo remoto) → nombre `cachifa-b2` → tipo `b2` → pega `account`
   (el keyID) y `key` → en *Edit advanced config?* responde `y` y pon
   **`hard_delete` = `true`** (si no, B2 guarda las versiones borradas y la
   retención no libera espacio) → el resto por defecto.
4. `n` otra vez → nombre **`cachifa-crypt`** → tipo `crypt` →
   `remote`: `cachifa-b2:cachifa-backups` → `filename_encryption`: `standard`
   → `directory_name_encryption`: `true` → contraseña: **`g` (generar)**
   (acepta el tamaño que propone o sube a 256 bits) → *salt* (`password2`):
   **`g`** también. rclone muestra cada una **una sola vez** antes de
   confirmarla: **cópialas al gestor de contraseñas en ese momento.**
5. `q` para salir.

**Opción B — Google Drive.** Igual, pero el primer remoto es `drive`
(nombre `cachifa-drive`). Drive usa OAuth: el asistente pide autorizar en un
navegador; dentro del contenedor no hay navegador, así que responde `n` a
*"Use web browser to automatically authenticate"* y sigue las instrucciones
(`rclone authorize "drive"` en una máquina con navegador, p. ej. con
`brew install rclone`). En la config avanzada pon `use_trash` = `false` para que
la retención borre de verdad. El `crypt` se crea igual, con `remote = cachifa-drive:cachifa-backups`.
El servicio trabaja sobre una copia de la config, así que la renovación del
token de Drive funciona aunque el archivo esté montado en solo lectura.

Al final, protege el archivo y pruébalo (en Linux el contenedor lo crea como
`root`: antes haz `sudo chown "$USER" ~/.config/cachifa-backup/rclone.conf`):

```bash
chmod 600 ~/.config/cachifa-backup/rclone.conf
docker run --rm --entrypoint rclone \
  -v ~/.config/cachifa-backup:/config/rclone:ro \
  cachifa-backup:prod lsd cachifa-crypt:       # no debe dar error
```

Si el remoto no se llama `cachifa-crypt`, pon `BACKUP_RCLONE_REMOTE=<nombre>:`
en el `.env`.

### 5.3 Levantar el servicio

```bash
docker compose -f docker-compose.prod.yml up -d backup
docker compose -f docker-compose.prod.yml logs -f backup
```

Solo levanta `backup` (y `postgres` si no estaba arriba); no reinicia `app` ni
`cloudflared`. Si es la primera vez y ya pasaron las 03:00, el primer backup
corre en ese momento. Un `up -d --build` normal del despliegue (§4) también lo
levanta o lo actualiza.

### 5.4 Ver el estado

```bash
# Último intento (result: "ok" | "error", lastSuccessAt = último backup bueno)
docker compose -f docker-compose.prod.yml exec backup cachifa-backup status

# Qué hay en local y en cada nivel remoto (nombres ya descifrados)
docker compose -f docker-compose.prod.yml exec backup cachifa-backup list

# Logs: cada paso queda con fecha; los fallos empiezan por "ERROR:"
docker compose -f docker-compose.prod.yml logs --since 48h backup
```

**Señal de alarma:** `lastSuccessAt` de hace más de un día, o `result: "error"`.

Para forzar un backup ahora (por ejemplo, **antes de un despliegue con
migraciones**):

```bash
docker compose -f docker-compose.prod.yml exec backup cachifa-backup run
```

### 5.5 Probar que se puede restaurar

```bash
scripts/restore-test.sh                      # último dump local
scripts/restore-test.sh --remote             # último dump de daily/ en el remoto (prueba también el descifrado)
scripts/restore-test.sh --file <ruta.sql.gz> # un archivo de este equipo (lo usa scripts/backup-now.sh, §5.7)
scripts/restore-test.sh ... --compare        # además compara las filas con cachifa_db (solo lectura)
```

Restaura en una base de descarte `cachifa_restore_test` del mismo Postgres,
muestra cuántas filas tienen las tablas clave, falla si falta alguna tabla y
borra la base al terminar. Se niega a restaurar un dump que cambie de base
(`\connect` o `CREATE DATABASE`, como los de `pg_dump -C`). **No toca `cachifa_db`.** Conviene correrlo una vez
al mes y después de cambiar la config de rclone.

> Un backup que nunca se restauró es una suposición, no un respaldo.

### 5.6 Restaurar de verdad

Esto **reemplaza** el contenido de `cachifa_db` (el dump trae `--clean`).

```bash
# 1. Para la API para que nadie escriba mientras tanto
docker compose -f docker-compose.prod.yml stop app

# 2. Guarda el estado actual por si acaso
docker compose -f docker-compose.prod.yml exec backup cachifa-backup run

# 3a. Desde el último dump local (o elige otro con `cachifa-backup list`)
docker compose -f docker-compose.prod.yml exec backup sh -c \
  'gunzip -c "$(ls -1 /backups/cachifa-*.sql.gz | sort | tail -n 1)" | psql -v ON_ERROR_STOP=1 -q >/dev/null'

# 3b. …o desde el remoto (daily, weekly o monthly)
docker compose -f docker-compose.prod.yml exec backup sh -c \
  'gunzip -c "$(cachifa-backup fetch daily | tail -n 1)" | psql -v ON_ERROR_STOP=1 -q >/dev/null'

# 4. Comprueba el esquema y vuelve a levantar la API
docker compose -f docker-compose.prod.yml run --rm app pnpm prisma migrate status
docker compose -f docker-compose.prod.yml start app
```

`psql` dentro de `backup` ya apunta a `cachifa_db` con las credenciales del
`.env` (`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).

### 5.7 Backup puntual verificado (sin el servicio, sin rclone)

Mientras el servicio `backup` no esté listo (falta `rclone.conf`), este es el
**paso previo obligatorio** antes de una migración o una corrección de datos
(`docs/design-liabilities.md` G.1), el mismo día:

```bash
scripts/backup-now.sh
```

1. Hace `pg_dump` de producción en sesión de **solo lectura**
   (`default_transaction_read_only=on`) hacia
   `~/cachifa-backups/cachifa-AAAAMMDD-HHMM.sql.gz`, con permisos `600` (la
   carpeta queda en `700`). Mismas opciones que el servicio: `--clean --if-exists`.
2. Lo verifica: `gzip -t`, tamaño mayor que 0 y la marca de fin de `pg_dump`.
3. Corre `scripts/restore-test.sh --file <dump> --compare`: lo restaura en la
   base de descarte `cachifa_restore_test`, cuenta las filas de las tablas
   clave, las compara con `cachifa_db` (en solo lectura) y borra la base de
   descarte. Si las cuentas no coinciden, falla (si la app escribió entre el
   volcado y la comparación, basta con correrlo otra vez).
4. Imprime ruta, tamaño y `sha256`.

**Nunca escribe en `cachifa_db`.** Pero el archivo queda en el mismo disco que la
base: **cópialo fuera del laptop** (Drive, USB…) antes de seguir. Un dump que
vive junto a la base **no es un backup**. `BACKUP_NOW_DIR` cambia la carpeta.

Para restaurarlo de verdad, como en §5.6 pero desde el archivo:

```bash
gunzip -c ~/cachifa-backups/cachifa-AAAAMMDD-HHMM.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U postgres -d cachifa_db -v ON_ERROR_STOP=1 -q >/dev/null
```

Dump a mano, sin ninguna verificación (último recurso):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d cachifa_db --clean --if-exists \
  | gzip > ~/backups/cachifa-$(date +%Y%m%d-%H%M).sql.gz
```

`exec -T` evita que Docker asigne un TTY y corrompa el archivo.

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

1. El repo (o al menos `docker-compose.prod.yml` + `Dockerfile` + `prisma/` + `backup/`).
2. El archivo `.env` (ajustando `DATABASE_URL` si cambian las credenciales).
3. `~/.config/cachifa-backup/rclone.conf` (desde el gestor de contraseñas si la
   laptop ya no está): con él, el VPS lee los backups cifrados y sigue subiendo.
4. El dump a restaurar: el más reciente del remoto (§5.6, opción 3b).

En el VPS, con solo Docker instalado:

```bash
docker compose -f docker-compose.prod.yml up -d --build postgres backup
docker compose -f docker-compose.prod.yml exec backup sh -c \
  'gunzip -c "$(cachifa-backup fetch daily | tail -n 1)" | psql -v ON_ERROR_STOP=1 -q >/dev/null'
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app pnpm prisma migrate deploy
```

Apaga el servicio `backup` de la laptop cuando el VPS ya esté subiendo, para no
tener dos máquinas escribiendo en el mismo remoto.

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
| Logs de `backup` con `rclone config not found` | Falta `~/.config/cachifa-backup/rclone.conf` en el host (§5.2), o `BACKUP_RCLONE_CONFIG_DIR` apunta a otra carpeta |
| Logs de `backup` con `remote 'cachifa-crypt:' is not defined` | El remoto `crypt` tiene otro nombre: ponlo en `BACKUP_RCLONE_REMOTE` (§5.2) |
| `backup` con `result: "error"` y `pg_dump failed` | `postgres` caído o credenciales `POSTGRES_*` distintas a las de la base |
