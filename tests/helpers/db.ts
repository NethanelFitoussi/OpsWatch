import { createDb, type Db } from '@/lib/db/client';

export function createTestDb(): Db {
  return createDb(':memory:');
}
