import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env';

/**
 * Field-level encryption for sensitive data at rest (SSNs, bank numbers).
 * AES-256-GCM with a random 96-bit IV and authentication tag.
 * Data is simulated/fake — but the platform demonstrates real security habits.
 *
 * Ciphertext format: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 */
const KEY = createHash('sha256').update(env.encryptionKey).digest();

export function encryptSensitive(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSensitive(payload: string): string {
  const [v, ivB64, tagB64, ctB64] = payload.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unrecognized ciphertext envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Deterministic hash — used for search keys / checksums (never for reversible data). */
export function fingerprint(value: string): string {
  return createHash('sha256').update(`${env.encryptionKey}|${value}`).digest('hex').slice(0, 32);
}
