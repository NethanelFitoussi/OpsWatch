import 'server-only';
import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to argon2id. Parameters follow the OWASP minimum
// (19 MiB memory, 2 iterations, parallelism 1).
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
