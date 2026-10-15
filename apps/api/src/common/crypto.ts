import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256-GCM for secrets at rest (each restaurant's Paystack secret key). Format: iv.tag.data, base64. */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored: string, keyB64: string): string {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Readable temporary password for invited staff, e.g. "kite-4821-amber". */
export function tempPassword(): string {
  const words = ['amber', 'basil', 'cedar', 'delta', 'ember', 'fig', 'ginger', 'honey', 'iris', 'jade', 'kite', 'lime'];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const num = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
  return `${pick()}-${num}-${pick()}`;
}
