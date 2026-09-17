import { describe, expect, it } from 'vitest';
import { DecryptionError, decrypt, encrypt, hashToken, randomId, randomToken } from '@/lib/crypto';
import { OTHER_SECRET as OTHER, TEST_SECRET as SECRET } from '../helpers/fixtures';

describe('encrypt / decrypt', () => {
  it('round-trips a value', () => {
    const payload = encrypt('{"accessKeyId":"AKIA"}', SECRET);
    expect(payload).not.toContain('AKIA');
    expect(decrypt(payload, SECRET)).toBe('{"accessKeyId":"AKIA"}');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same', SECRET)).not.toBe(encrypt('same', SECRET));
  });

  it('rejects a tampered payload', () => {
    const payload = Buffer.from(encrypt('secret', SECRET), 'base64url');
    payload[payload.length - 1] ^= 0xff;
    expect(() => decrypt(payload.toString('base64url'), SECRET)).toThrow(DecryptionError);
  });

  it('rejects a payload encrypted with another secret', () => {
    expect(() => decrypt(encrypt('secret', SECRET), OTHER)).toThrow(DecryptionError);
  });

  it('rejects garbage', () => {
    expect(() => decrypt('abc', SECRET)).toThrow(DecryptionError);
  });
});

describe('hashToken', () => {
  it('is deterministic per secret and differs across secrets', () => {
    expect(hashToken('t', SECRET)).toBe(hashToken('t', SECRET));
    expect(hashToken('t', SECRET)).not.toBe(hashToken('t', OTHER));
    expect(hashToken('t', SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('random values', () => {
  it('randomToken is base64url of 32 bytes by default', () => {
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32);
  });

  it('randomId is 12 lowercase hex characters', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{12}$/);
  });
});
