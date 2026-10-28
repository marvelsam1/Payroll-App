/**
 * Jest global setup: ensures the test database exists and has the schema
 * applied (via the portable migration runner). Requires the local Postgres
 * started by `npm run db:start`.
 */
import { Client, ClientConfig } from 'pg';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function loadTestEnv(): void {
  const envPath = path.resolve(__dirname, '../.env.test');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const url = process.env.DATABASE_URL!;
  const parsed = new URL(url);

  // 1. wait for the server (embedded pg may still be warming up)
  const adminUrl = new URL(url);
  const dbName = adminUrl.pathname.replace('/', '');
  adminUrl.pathname = '/postgres';
  let lastErr: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const admin = new Client({ connectionString: adminUrl.toString() });
      await admin.connect();
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (exists.rowCount === 0) {
        await admin.query(`CREATE DATABASE "${dbName}"`);
      }
      await admin.end();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (lastErr) {
    throw new Error(
      `Test database not reachable at ${parsed.host}/${dbName}. Start Postgres first (npm run db:start). ${String(lastErr)}`,
    );
  }

  // 2. apply migrations (runner honors DATABASE_URL from the environment)
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/migrate.mjs')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Migration failed for test DB:\n${result.stdout}\n${result.stderr}`);
  }
}
