import * as path from 'path';
import * as dotenv from 'dotenv';

// Loads apps/api/.env — dotenv never overrides variables already set
// (tests preload .env.test first, Docker sets env directly).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function num(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3001),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@127.0.0.1:5432/payledger',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-not-for-production-payledger-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  queueDriver: (process.env.QUEUE_DRIVER ?? 'auto') as 'auto' | 'bullmq' | 'memory',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  achSettleDelayMs: num('ACH_SETTLE_DELAY_MS', 6000),
  achProcessingDelayMs: num('ACH_PROCESSING_DELAY_MS', 1500),
  payrollProcessDelayMs: num('PAYROLL_PROCESS_DELAY_MS', 1200),
  encryptionKey: process.env.ENCRYPTION_KEY ?? 'dev-encryption-key-32-bytes-long!!',
  storageDir: process.env.STORAGE_DIR ?? './storage',
};
