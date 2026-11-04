import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';
import { assertSafePrismaCommand } from './prisma/real-db-guard';

// With a config file the Prisma CLI no longer reads .env by itself, so it is
// loaded here. Variables already in the environment win, as before (that is
// how scripts/test-migration-on-copy.sh points Prisma at its copy).
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// There is no development database: refuse to write to the real one from the
// host (prisma/real-db-guard.ts). The production image does not copy this
// file, so `migrate deploy` inside the app container is not affected.
assertSafePrismaCommand(process.argv.slice(2), process.env);

// Same settings as `package.json#prisma`, which the CLI ignores while this file
// exists; the production image (without this file) still reads them from there.
export default defineConfig({
  schema: join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: join(__dirname, 'prisma', 'migrations'),
    seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  },
});
