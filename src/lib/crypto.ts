import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

type Purpose = 'access-keys' | 'sessions' | 'google-sign-in' | 'ai-provider' | 'cloudflare';
/** Purposes of the values `encrypt` seals: each gets its own key, so one cannot be passed off as another. */
type EncryptionPurpose = Exclude<Purpose, 'sessions'>;

function deriveKey(secret: string, purpose: Purpose): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'opswatch', purpose, 32));
}

export class DecryptionError extends Error {
  constructor() {
    super('Stored secret could not be decrypted (tampered data or changed OPSWATCH_SECRET)');
    this.name = 'DecryptionError';
  }
}

export function encrypt(plaintext: string, secret: string, purpose: EncryptionPurpose = 'access-keys'): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decrypt(payload: string, secret: string, purpose: EncryptionPurpose = 'access-keys'): string {
  try {
    const data = Buffer.from(payload, 'base64url');
    if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
      throw new Error('payload too short');
    }
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret, 'sessions')).update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * A plain SHA-256, hex. Unkeyed on purpose: this is used for identity, not authentication, and a problem's
 * dedupe key has to be the same on every instance and across a rotation of `OPSWATCH_SECRET` — a keyed digest
 * would re-key every open problem in the field. Never use it for anything a secret must protect.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
