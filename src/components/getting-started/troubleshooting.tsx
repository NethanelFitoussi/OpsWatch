import { ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['assumeRole', 'region', 'pi', 'scp', 'account'] as const;

export async function Troubleshooting() {
  const t = await getTranslations('GettingStarted.troubleshooting.items');

  return (
    <div className="divide-y rounded-lg border">
      {ITEMS.map((key) => (
        <details key={key} className="group p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
            {t(`${key}.title`)}
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">{t(`${key}.body`)}</p>
        </details>
      ))}
    </div>
  );
}
