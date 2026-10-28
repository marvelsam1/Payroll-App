import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('./.env', import.meta.url).pathname });

/**
 * Prisma 7 config. Connection URLs for Migrate live here (not in the schema).
 * In restricted environments `npm run generate` / `npm run migrate` use the
 * project scripts, which avoid Prisma's binary CDN entirely (WASM engine).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:password@127.0.0.1:5432/payledger',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'npm run seed',
  },
});
