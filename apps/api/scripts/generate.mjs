/**
 * Prisma client generation with a fallback for networks that cannot reach
 * binaries.prisma.sh (the CLI eagerly checks for the schema-engine binary even
 * though generation itself is WASM-based in Prisma 7). We first try the normal
 * `prisma generate`; if that fails because of the engine CDN, we retry with a
 * local stub pointed at by PRISMA_SCHEMA_ENGINE_BINARY, which the CLI accepts
 * as "engine present" without downloading anything.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

function run(extraEnv = {}) {
  return spawnSync('npx', ['prisma', 'generate'], {
    cwd: apiRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
}

const first = run();
const out = `${first.stdout ?? ''}${first.stderr ?? ''}`;

if (first.status === 0) {
  process.stdout.write(out);
  process.exit(0);
}

if (/binaries\.prisma\.sh|ENOTFOUND|ETIMEDOUT|TLS|fetch failed|socket disconnected/i.test(out)) {
  // Offline fallback: pretend the engine binary exists locally.
  const stub = '/bin/true';
  console.log('[generate] engine CDN unreachable — retrying with local schema-engine stub');
  const second = run({ PRISMA_SCHEMA_ENGINE_BINARY: stub });
  const out2 = `${second.stdout ?? ''}${second.stderr ?? ''}`;
  process.stdout.write(out2);
  process.exit(second.status ?? 1);
}

process.stdout.write(out);
process.exit(first.status ?? 1);
