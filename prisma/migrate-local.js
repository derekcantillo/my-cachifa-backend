#!/usr/bin/env node
// `pnpm prisma:migrate` (`prisma migrate dev` with DATABASE_URL_LOCAL). Runs with
// ts-node so it can use prisma/real-db-guard.ts: DATABASE_URL_LOCAL is the real
// database on this laptop, so this refuses unless it points somewhere else.
const { execFileSync } = require('child_process');
const { checkPrismaCommand } = require('./real-db-guard');

if (process.env.DATABASE_URL_LOCAL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_LOCAL;
}

const refusal = checkPrismaCommand(['migrate', 'dev'], process.env);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}

execFileSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'dev'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);
