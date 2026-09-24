'use server';

import { revalidatePath } from 'next/cache';
import { resolveLocale } from '@/i18n/routing';
import { auditedAdmin } from '@/lib/auth/audited';
import { writeBackup } from '@/lib/db/backup';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/forms/action-state';

/**
 * Taking a backup on demand (HIS-10).
 *
 * Audited as `export_download`, which is what it is: a complete copy of the database exists on disk
 * afterwards, and §21 records who asked for one.
 *
 * There is no restore action, and that is the design rather than an omission. A running process cannot
 * safely write over the database it has open, and a restore that half-succeeds leaves an operator worse
 * off than one that never ran. The page gives the procedure instead.
 */
export type BackupState = ActionState<'failed', { created?: string }>;

export async function createBackupAction(locale: string, _prev: BackupState, _formData: FormData): Promise<BackupState> {
  return auditedAdmin(resolveLocale(locale), 'export_download', 'backup', async (): Promise<BackupState> => {
    try {
      const backup = writeBackup(getDb(), env().OPSWATCH_DATA_DIR, Date.now(), 'manual');
      revalidatePath(`/${resolveLocale(locale)}/settings/backup`);
      return { created: backup.name };
    } catch {
      // The reason is not carried to the page: it can contain a path, and a path is one more thing an
      // error message should not be publishing. The class of failure is what an operator can act on.
      return { error: 'failed' };
    }
  });
}
