import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { getCurrentAdminId } from '@/lib/auth/current';
import { backupsDir, resolveBackup } from '@/lib/db/backup';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { appendAudit } from '@/lib/store/audit';

export const dynamic = 'force-dynamic';

/**
 * Downloading one backup (HIS-10).
 *
 * **This is the whole database.** Every encrypted credential, every session row, every setting. It is a
 * legitimate thing for the administrator of a self-hosted instance to have — it is their data on their
 * machine — and it is the single most sensitive response this application can produce, so:
 *
 *   - a session is required, and an anonymous request gets 401 rather than a hint that the file exists;
 *   - the name is not sanitised, it is **matched against the files actually there**. A pattern check can
 *     be got around by an encoding nobody thought of; "is this one of the names a listing just produced"
 *     cannot;
 *   - §21 records the download, because who took a copy of the database is exactly the kind of thing an
 *     audit log is for;
 *   - the ciphertexts inside are useless without `OPSWATCH_SECRET`, which is not in the file. The
 *     settings page says so, because an operator who backs up the database and loses the secret has
 *     backed up something they cannot restore.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }): Promise<NextResponse> {
  const adminId = await getCurrentAdminId();
  if (adminId === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { name } = await params;
  const file = resolveBackup(backupsDir(env().OPSWATCH_DATA_DIR), name);
  if (file === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  appendAudit(getDb(), {
    at: Date.now(),
    actorUserId: adminId,
    actorKind: 'user',
    action: 'export_download',
    subjectType: 'backup',
    subjectId: name,
    result: 'ok',
    ip: null,
    userAgent: null,
    details: {},
  });

  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${name}"`,
      // Never rendered, never cached by anything in front: it is the database.
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store, private',
    },
  });
}
