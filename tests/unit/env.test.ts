import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '@/lib/env';

const SECRET = 'x'.repeat(32);

describe('loadEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv({ OPSWATCH_SECRET: SECRET });
    expect(env.OPSWATCH_SECRET).toBe(SECRET);
    expect(env.OPSWATCH_DATA_DIR).toBe('/data');
    expect(env.OPSWATCH_PUBLIC_URL).toBeUndefined();
  });

  it('rejects a missing secret', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => loadEnv({ OPSWATCH_SECRET: 'short' })).toThrow(/OPSWATCH_SECRET/);
  });

  it('rejects malformed URLs', () => {
    expect(() =>
      loadEnv({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'not a url' }),
    ).toThrow(/OPSWATCH_PUBLIC_URL/);
  });

  it('keeps optional values when valid', () => {
    const env = loadEnv({
      OPSWATCH_SECRET: SECRET,
      OPSWATCH_DATA_DIR: '/tmp/ow',
      OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
      OPSWATCH_TEMPLATE_BUCKET: 'my-bucket',
      OPSWATCH_AWS_ENDPOINT_URL: 'http://moto:5000',
    });
    expect(env).toMatchObject({
      OPSWATCH_DATA_DIR: '/tmp/ow',
      OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
      OPSWATCH_TEMPLATE_BUCKET: 'my-bucket',
      OPSWATCH_AWS_ENDPOINT_URL: 'http://moto:5000',
    });
  });
});
