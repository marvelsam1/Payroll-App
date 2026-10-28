/**
 * Dev tool: authors `prisma/migrations/0_init/migration.sql` straight from
 * schema.prisma using Prisma's WASM schema engine (offline — no engine CDN).
 * Only needed when the Prisma schema changes; the resulting SQL is committed.
 */
import { SchemaEngine } from '@prisma/schema-engine-wasm';
import { bindMigrationAwareSqlAdapterFactory } from '@prisma/driver-adapter-utils';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const schemaPath = path.join(apiRoot, 'prisma', 'schema.prisma');
const outDir = path.join(apiRoot, 'prisma', 'migrations', '20261028000000_init');

const schema = fs.readFileSync(schemaPath, 'utf8');
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@127.0.0.1:5432/payledger_shadow';

const raw = new PrismaPg({ connectionString });
const bound = bindMigrationAwareSqlAdapterFactory(raw);
const engine = await SchemaEngine.new({ datamodels: undefined }, () => {}, bound);

const res = await engine.diff({
  from: { tag: 'empty' },
  to: { tag: 'schemaDatamodel', files: [{ path: 'schema.prisma', content: schema }] },
  script: true,
  exitCode: false,
  filters: { externalTables: [], externalEnums: [] },
});

if (!res.stdout || res.stdout.trim().length === 0) {
  console.error('diff produced no SQL');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'migration.sql'), res.stdout);
console.log(`wrote ${path.join(outDir, 'migration.sql')} (${res.stdout.length} bytes)`);
process.exit(0);
