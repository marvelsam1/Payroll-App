/**
 * Starts an embedded PostgreSQL server (binaries shipped via npm — works where
 * Docker is unavailable). Creates the dev, shadow, and test databases.
 *
 * Usage: npm run db:start
 * Keep this process alive for the lifetime of the dev environment.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'password',
  port: 5432,
  persistent: true,
});

const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

try {
  if (!alreadyInitialised) {
    console.log('[pg] initialising cluster at', dataDir);
    await pg.initialise();
  }
  console.log('[pg] starting server on port 5432…');
  await pg.start();
} catch (err) {
  if (String(err?.message ?? err).includes('already')) {
    console.log('[pg] already running');
  } else {
    console.error('[pg] failed to start:', err);
    process.exit(1);
  }
}

for (const db of ['payledger', 'payledger_shadow', 'payledger_test']) {
  try {
    await pg.createDatabase(db);
    console.log(`[pg] created database ${db}`);
  } catch (e) {
    // exists — fine
    console.log(`[pg] database ${db} already exists`);
  }
}

console.log('[pg] ready. Leave this process running; press Ctrl+C to stop.');
// Keep the process (and the postgres child) alive.
await new Promise(() => {});
