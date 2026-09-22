import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { createTestDb } from '../helpers/db';

const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));

// Mocked at the Next boundary: the action's own logic is what is under test, not Next's cache internals.
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/auth/current', () => ({ requireAdmin: async () => 1 }));
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb: () => state.db,
}));

const { saveSettingsAction } = await import('@/app/[locale]/(app)/settings/actions');

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  state.db = createTestDb();
  revalidatePath.mockClear();
});

describe('saveSettingsAction', () => {
  it('revalidates the whole layout, with the exact arguments every page depends on, once the save succeeds', async () => {
    const result = await saveSettingsAction(
      'en',
      {},
      form([
        ['refreshIntervalMs', '30000'],
        ['defaultRange', '12h'],
      ]),
    );
    expect(result).toEqual({ saved: true });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('never revalidates when the input is refused', async () => {
    const result = await saveSettingsAction(
      'en',
      {},
      form([
        ['refreshIntervalMs', '45000'],
        ['defaultRange', '12h'],
      ]),
    );
    expect(result).toEqual({ error: 'refresh_invalid' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
