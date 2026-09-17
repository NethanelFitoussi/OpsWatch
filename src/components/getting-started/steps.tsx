import { getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/copy-button';
import { BASE_IDENTITY_POLICY } from '@/lib/aws/actions';

function StepList({ items, idPrefix, startAt }: { items: { title: string; body: string; extra?: React.ReactNode }[]; idPrefix?: string; startAt: number }) {
  return (
    <ol className="space-y-6">
      {items.map((item, index) => {
        const number = startAt + index;
        return (
          <li key={item.title} id={idPrefix ? `${idPrefix}-${number}` : undefined} className="flex gap-4 scroll-mt-20">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
              {number}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h4 className="font-medium">{item.title}</h4>
              <p className="text-sm text-muted-foreground">{item.body}</p>
              {item.extra}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export async function Steps() {
  const t = await getTranslations('GettingStarted');
  const policy = JSON.stringify(BASE_IDENTITY_POLICY, null, 2);

  return (
    <div className="space-y-12">
      <div>
        <h3 className="mb-6 text-lg font-semibold">{t('role.title')}</h3>
        <StepList
          idPrefix="step"
          startAt={0}
          items={[
            {
              title: t('role.steps.s0.title'),
              body: t('role.steps.s0.body'),
              extra: (
                <div className="space-y-2">
                  <p className="text-xs font-medium">{t('role.steps.s0.policyLabel')}</p>
                  <div className="flex items-start gap-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{policy}</pre>
                    <CopyButton value={policy} />
                  </div>
                </div>
              ),
            },
            { title: t('role.steps.s1.title'), body: t('role.steps.s1.body') },
            { title: t('role.steps.s2.title'), body: t('role.steps.s2.body') },
            { title: t('role.steps.s3.title'), body: t('role.steps.s3.body') },
            { title: t('role.steps.s4.title'), body: t('role.steps.s4.body') },
          ]}
        />
      </div>

      <div id="ambient" className="scroll-mt-20">
        <h3 className="mb-6 text-lg font-semibold">{t('ambient.title')}</h3>
        <StepList
          startAt={1}
          items={[
            { title: t('ambient.steps.s1.title'), body: t('ambient.steps.s1.body') },
            { title: t('ambient.steps.s2.title'), body: t('ambient.steps.s2.body') },
          ]}
        />
      </div>

      <div id="keys" className="scroll-mt-20">
        <h3 className="mb-6 text-lg font-semibold">{t('keys.title')}</h3>
        <StepList
          startAt={1}
          items={[
            { title: t('keys.steps.s1.title'), body: t('keys.steps.s1.body') },
            { title: t('keys.steps.s2.title'), body: t('keys.steps.s2.body') },
            { title: t('keys.steps.s3.title'), body: t('keys.steps.s3.body') },
          ]}
        />
      </div>
    </div>
  );
}
