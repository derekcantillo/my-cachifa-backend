/**
 * Seguro contra migraciones accidentales desde el host.
 *
 * En este laptop no hay base de desarrollo aparte: `localhost:5432` (y
 * `DATABASE_URL_LOCAL`, y los nombres `cachifa_db`/`postgres` de Compose) son la
 * base real. Todo comando de Prisma que escribe en la base se niega a correr si
 * `DATABASE_URL` o `DATABASE_URL_LOCAL` apuntan ahí, salvo con
 * `ALLOW_MIGRATE_REAL_DB=1`.
 *
 * Lo usan `prisma.config.ts` (cualquier `prisma …` desde el host, también
 * `pnpm prisma:migrate`) y `prisma/seed.ts`. La imagen de producción no copia
 * `prisma.config.ts`: el `migrate deploy` de DEPLOY.md corre dentro del
 * contenedor `app` sin este chequeo.
 */

/** Así se llega a la base real: el puerto publicado en el host… */
const LOCAL_HOSTS = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
];
const REAL_DB_PORT = '5432';
/** …o, desde un contenedor de Compose, el nombre del servicio o del contenedor. */
const COMPOSE_HOSTS = ['postgres', 'cachifa_db'];

/** Subcomandos que escriben en la base. `migrate status`/`diff` y `db pull` solo leen. */
const WRITING_SUBCOMMANDS: Record<string, string[]> = {
  migrate: ['dev', 'deploy', 'reset', 'resolve'],
  db: ['push', 'execute', 'seed'],
};

export const ALLOW_FLAG = 'ALLOW_MIGRATE_REAL_DB';

type Env = Record<string, string | undefined>;

/** `host:puerto/base` si la URL apunta a la base real; `null` si no (o no se puede leer). */
export function realDatabaseTarget(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || REAL_DB_PORT;
  const isReal =
    COMPOSE_HOSTS.includes(host) ||
    (LOCAL_HOSTS.includes(host) && port === REAL_DB_PORT);
  return isReal ? `${host}:${port}${parsed.pathname}` : null;
}

/** `"migrate deploy"` si los argumentos son un comando que escribe en la base. */
export function writingCommand(args: readonly string[]): string | null {
  for (const [command, subcommands] of Object.entries(WRITING_SUBCOMMANDS)) {
    const index = args.indexOf(command);
    const subcommand = index === -1 ? undefined : args[index + 1];
    if (subcommand && subcommands.includes(subcommand)) {
      return `${command} ${subcommand}`;
    }
  }
  return null;
}

/** `--url <x>` o `--url=<x>` (`prisma db execute`). */
function urlFlag(args: readonly string[]): string | undefined {
  const index = args.indexOf('--url');
  if (index !== -1) return args[index + 1];
  return args.find((arg) => arg.startsWith('--url='))?.slice('--url='.length);
}

export function refusalMessage(command: string, targets: string[]): string {
  return [
    `Refusing to run \`prisma ${command}\` against the real database (${targets.join(', ')}).`,
    'There is no separate development database on this laptop: localhost:5432 is production.',
    '- To test a migration: scripts/test-migration-on-copy.sh (a throwaway copy, DEPLOY.md §4.1).',
    '- To migrate production: follow DEPLOY.md (backup of the day, §5.7, then `migrate deploy` inside the app container).',
    `- Only if you really mean it from here: ${ALLOW_FLAG}=1.`,
  ].join('\n');
}

/**
 * `null` si el comando puede correr; si no, el mensaje de rechazo. Con el
 * permiso explícito avisa por `warn` y deja pasar.
 */
export function checkPrismaCommand(
  args: readonly string[],
  env: Env,
  warn: (message: string) => void = console.warn,
): string | null {
  const command = writingCommand(args);
  if (!command) return null;

  const targets = [
    ['DATABASE_URL', env.DATABASE_URL],
    ['DATABASE_URL_LOCAL', env.DATABASE_URL_LOCAL],
    ['--url', urlFlag(args)],
  ].flatMap(([name, url]) => {
    const target = realDatabaseTarget(url);
    return target ? [`${name} → ${target}`] : [];
  });
  if (targets.length === 0) return null;

  if (env[ALLOW_FLAG] === '1') {
    warn(
      `⚠ ${ALLOW_FLAG}=1: running \`prisma ${command}\` against the real database (${targets.join(', ')}).`,
    );
    return null;
  }
  return refusalMessage(command, targets);
}

/** Lanza un error con el mensaje de rechazo si el comando no puede correr. */
export function assertSafePrismaCommand(
  args: readonly string[],
  env: Env,
): void {
  const refusal = checkPrismaCommand(args, env);
  if (refusal) {
    throw new Error(refusal);
  }
}
