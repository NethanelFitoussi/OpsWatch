import { BookOpen } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { docPath } from '@/lib/docs/catalogue';

/**
 * The way out of a dead end.
 *
 * Wherever OpsWatch has to say it cannot do something — no telemetry, no mapping, a setting switched off
 * — it also says where to learn how. An honest empty state that leaves the reader stuck is still a dead
 * end; it is just a polite one.
 */
export function DocLink({ slug, label }: { slug: string; label: string }) {
  return (
    <Link
      href={docPath(slug)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <BookOpen className="size-3.5 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
