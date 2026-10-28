/**
 * One-shot database bootstrap:
 *   1. verifies Postgres is reachable (start it with `npm run db:start`)
 *   2. creates databases if missing
 *   3. applies all pending Prisma migration files
 *   4. generates the Prisma client
 *
 * Usage:  npm run db:setup          # idempotent
 *         npm run db:reset -- --force  # drop schema and re-apply
 */
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

function loadEnvFile(file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile('apps/api/.env');
process.env.DATABASE_URL ??= 'postgresql://postgres:password@127.0.0.1:5432/payledger';

const adminUrl = new URL(process.env.DATABASE_URL);
const targetDb = adminUrl.pathname.replace('/', '') || 'payledger';

async function withDb(dbName, fn) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${dbName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// 1. reachability
const probe = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await probe.connect();
  await probe.end();
} catch {
  console.error('✗ Postgres is not reachable at ' + process.env.DATABASE_URL);
  console.error('  Start it first:  npm run db:start');
  process.exit(1);
}

// 2. databases
const server = new Client({
  connectionString: (() => {
    const u = new URL(process.env.DATABASE_URL);
    u.pathname = '/postgres';
    return u.toString();
  })(),
});
await server.connect();
for (const db of ['payledger', 'payledger_shadow', 'payledger_test']) {
  const res = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (res.rowCount === 0) {
    await server.query(`CREATE DATABASE "${db}"`);
    console.log('✓ created database', db);
  }
}
await server.end();

// 3. (optional) drop schema
if (force) {
  await withDb(targetDb, async (c) => {
    // CASCADE drop all app tables (incl. enums); keeps an empty DB.
    const tables = await c.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`,
    );
    if (tables.rowCount > 0) {
      const list = tables.rows.map((r) => `"${r.tablename}"`).join(', ');
      await c.query(`DROP TABLE IF EXISTS ${list} CASCADE`);
    }
    const enums = await c.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    );
    for (const e of enums.rows) await c.query(`DROP TYPE IF EXISTS "${e.typname}" CASCADE`);
    await c.query('DELETE FROM "_prisma_migrations"');
    console.log('✓ dropped application schema');
  });
}

// 4. migrate
const migrate = path.join(root, 'apps/api/scripts/migrate.mjs');
const r1 = spawnSync(process.execPath, [migrate], { stdio: 'inherit', cwd: path.join(root, 'apps/api') });
if (r1.status !== 0) process.exit(r1.status ?? 1);

// 5. prisma client
const generate = path.join(root, 'apps/api/scripts/generate.mjs');
const r2 = spawnSync(process.execPath, [generate], { stdio: 'inherit', cwd: path.join(root, 'apps/api') });
if (r2.status !== 0) process.exit(r2.status ?? 1);

console.log('\n✓ database ready');
