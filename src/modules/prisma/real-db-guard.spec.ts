import {
  ALLOW_FLAG,
  assertSafePrismaCommand,
  checkPrismaCommand,
  realDatabaseTarget,
  writingCommand,
} from '../../../prisma/real-db-guard';

/** Same shape as the laptop's .env (password is a placeholder). */
const REAL_ENV = {
  DATABASE_URL: 'postgresql://postgres:secret@cachifa_db:5432/cachifa_db',
  DATABASE_URL_LOCAL: 'postgresql://postgres:secret@localhost:5432/cachifa_db',
};
const COPY_URL = 'postgresql://postgres:x@127.0.0.1:55432/cachifa_copy';
const COPY_ENV = { DATABASE_URL: COPY_URL, DATABASE_URL_LOCAL: COPY_URL };
const quiet = () => undefined;

describe('real-db-guard — qué es la base real', () => {
  it.each([
    'postgresql://u:p@localhost:5432/cachifa_db',
    'postgresql://u:p@127.0.0.1/cachifa_db',
    'postgresql://u:p@[::1]:5432/cachifa_db',
    'postgresql://u:p@LOCALHOST:5432/otra',
    'postgresql://u:p@cachifa_db:5432/cachifa_db',
    'postgresql://u:p@postgres/cachifa_db',
  ])('%s es la base real', (url) => {
    expect(realDatabaseTarget(url)).not.toBeNull();
  });

  it.each([
    COPY_URL,
    'postgresql://u:p@127.0.0.1:55433/cachifa_db',
    'postgresql://u:p@db.example.com:5432/cachifa_db',
    '',
    undefined,
    'not a url',
  ])('%p no lo es', (url) => {
    expect(realDatabaseTarget(url)).toBeNull();
  });

  it('el destino no incluye la contraseña', () => {
    expect(realDatabaseTarget(REAL_ENV.DATABASE_URL_LOCAL)).toBe(
      'localhost:5432/cachifa_db',
    );
  });
});

describe('real-db-guard — qué comandos escriben', () => {
  it.each([
    [['migrate', 'dev'], 'migrate dev'],
    [['migrate', 'deploy'], 'migrate deploy'],
    [['migrate', 'reset', '--force'], 'migrate reset'],
    [['migrate', 'resolve', '--applied', 'x'], 'migrate resolve'],
    [['--schema', 'prisma/schema.prisma', 'db', 'push'], 'db push'],
    [['db', 'execute', '--file', 'x.sql'], 'db execute'],
    [['db', 'seed'], 'db seed'],
  ])('%p escribe', (args, command) => {
    expect(writingCommand(args)).toBe(command);
  });

  it.each([
    [['migrate', 'status']],
    [['migrate', 'diff', '--from-url', 'x']],
    [['db', 'pull']],
    [['generate']],
    [['validate']],
    [['format']],
    [[]],
  ])('%p no escribe', (args) => {
    expect(writingCommand(args)).toBeNull();
  });
});

describe('real-db-guard — el chequeo', () => {
  it('rechaza migrate deploy con el .env del laptop y dice qué hacer', () => {
    const refusal = checkPrismaCommand(['migrate', 'deploy'], REAL_ENV, quiet);

    expect(refusal).toContain('Refusing to run `prisma migrate deploy`');
    expect(refusal).toContain('DATABASE_URL → cachifa_db:5432/cachifa_db');
    expect(refusal).toContain('DATABASE_URL_LOCAL → localhost:5432/cachifa_db');
    expect(refusal).toContain('scripts/test-migration-on-copy.sh');
    expect(refusal).toContain('DEPLOY.md');
    expect(refusal).toContain(`${ALLOW_FLAG}=1`);
    expect(refusal).not.toContain('secret');
  });

  it('basta con que una de las dos variables apunte a la base real', () => {
    expect(
      checkPrismaCommand(
        ['migrate', 'deploy'],
        { ...COPY_ENV, DATABASE_URL_LOCAL: REAL_ENV.DATABASE_URL_LOCAL },
        quiet,
      ),
    ).toContain('DATABASE_URL_LOCAL → localhost:5432/cachifa_db');
  });

  it('también mira el --url de db execute', () => {
    expect(
      checkPrismaCommand(
        ['db', 'execute', '--url', REAL_ENV.DATABASE_URL_LOCAL, '--stdin'],
        COPY_ENV,
        quiet,
      ),
    ).toContain('--url → localhost:5432/cachifa_db');
    expect(
      checkPrismaCommand(
        ['db', 'execute', `--url=${REAL_ENV.DATABASE_URL_LOCAL}`],
        COPY_ENV,
        quiet,
      ),
    ).not.toBeNull();
  });

  it('deja migrar una copia (scripts/test-migration-on-copy.sh)', () => {
    expect(
      checkPrismaCommand(['migrate', 'deploy'], COPY_ENV, quiet),
    ).toBeNull();
  });

  it('deja correr lo que no escribe, aunque apunte a la base real', () => {
    expect(
      checkPrismaCommand(['migrate', 'status'], REAL_ENV, quiet),
    ).toBeNull();
    expect(checkPrismaCommand(['generate'], REAL_ENV, quiet)).toBeNull();
  });

  it(`con ${ALLOW_FLAG}=1 deja pasar, avisando`, () => {
    const warn = jest.fn();

    const refusal = checkPrismaCommand(
      ['migrate', 'deploy'],
      { ...REAL_ENV, [ALLOW_FLAG]: '1' },
      warn,
    );

    expect(refusal).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('against the real database'),
    );
  });

  it.each(['true', 'yes', '0', ''])(
    `${ALLOW_FLAG}=%p no cuenta como permiso`,
    (value) => {
      expect(
        checkPrismaCommand(
          ['migrate', 'deploy'],
          { ...REAL_ENV, [ALLOW_FLAG]: value },
          quiet,
        ),
      ).not.toBeNull();
    },
  );

  it('assertSafePrismaCommand lanza el mensaje', () => {
    expect(() => assertSafePrismaCommand(['db', 'push'], REAL_ENV)).toThrow(
      'Refusing to run `prisma db push`',
    );
  });
});
