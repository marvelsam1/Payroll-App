/**
 * Portable migration runner.
 *
 * Applies the SQL files in `prisma/migrations/` in lexicographic order and
 * records them in a Prisma-compatible `_prisma_migrations` table, so the same
 * directory can also be applied with `npx prisma migrate deploy` in
 * environments that can reach Prisma's engine CDN. This runner needs nothing
 * but Node + a reachable Postgres — no engine binaries.
 */
import { Client } from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const migrationsDir = path.join(apiRoot, 'prisma', 'migrations');

function loadEnv() {
  const p = path.join(apiRoot, '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:password@127.0.0.1:5432/payledger';

const client = new Client({ connectionString: url });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  );
`);

if (!fs.existsSync(migrationsDir)) {
  console.log('[migrate] no migrations directory — nothing to do');
  await client.end();
  process.exit(0);
}

const dirs = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const appliedRes = await client.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE rolled_back_at IS NULL');
const applied = new Map(appliedRes.rows.map((r) => [r.migration_name, r.checksum]));

let ran = 0;
for (const dir of dirs) {
  const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
  if (!fs.existsSync(sqlPath)) continue;
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 64);

  if (applied.has(dir)) {
    if (applied.get(dir) !== checksum) {
      console.error(`[migrate] ✗ checksum mismatch for applied migration ${dir}`);
      await client.end();
      process.exit(1);
    }
    continue;
  }

  const id = crypto.randomUUID();
  await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())', [id, checksum, dir]);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
    await client.query('COMMIT');
    console.log(`[migrate] ✓ applied ${dir}`);
    ran++;
  } catch (err) {
    await client.query('ROLLBACK');
    await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [id, String(err.message ?? err)]);
    console.error(`[migrate] ✗ failed on ${dir}:`, err.message ?? err);
    await client.end();
    process.exit(1);
  }
}

console.log(ran === 0 ? '[migrate] already up to date' : `[migrate] applied ${ran} migration(s)`);
await client.end();
