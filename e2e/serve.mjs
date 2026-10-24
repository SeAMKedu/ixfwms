#!/usr/bin/env node
// Starts a server for the browser tests: a fresh data folder, an admin with a token (saved
// for the tests), and the web app built from the current source.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'e2e', '.data');
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });

const env = {
  ...process.env,
  IXF_DATA_DIR: data,
  IXF_PORT: process.env.E2E_PORT ?? '3931',
  IXF_BACKUP_HOUR: '-1',
  IXF_LOG_LEVEL: 'warn',
};
const tsx = ['tsx', '--conditions=development'];
const cli = (...args) =>
  execFileSync('npx', [...tsx, 'apps/server/src/cli.ts', ...args], { cwd: root, env }).toString();

execFileSync('npm', ['run', '-s', 'build', '-w', '@ixfwms/web'], { cwd: root, stdio: 'inherit' });
cli('user:create', '--name', 'e2e', '--role', 'admin');
writeFileSync(
  join(data, 'token'),
  cli('token:create', '--user', 'e2e', '--scopes', 'admin').trim(),
);

const server = spawn('npx', [...tsx, 'apps/server/src/main.ts'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
