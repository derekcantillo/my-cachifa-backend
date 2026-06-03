#!/usr/bin/env node
const { execFileSync } = require('child_process');

if (process.env.DATABASE_URL_LOCAL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_LOCAL;
}

execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'dev'], {
  stdio: 'inherit',
  env: process.env,
});
