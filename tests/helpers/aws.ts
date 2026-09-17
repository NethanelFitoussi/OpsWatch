import { expect } from 'vitest';

export const BASE_CREDENTIALS = { accessKeyId: 'BASE-FROM-ENV', secretAccessKey: 'base' };

/** Asserts the credentials an AWS SDK client signs its requests with. */
export async function expectSignedWith(client: { config: { credentials: unknown } }, accessKeyId: string) {
  const provider = client.config.credentials as () => Promise<{ accessKeyId: string }>;
  expect(await provider()).toMatchObject({ accessKeyId });
}
