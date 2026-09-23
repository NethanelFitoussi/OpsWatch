import { useTranslations } from 'next-intl';
import { Callout } from './callout';
import { ChainDiagram, FactGrid } from './chain-diagram';
import { GuideSection } from './guide-layout';
import { Method, Step } from './step-list';

/**
 * The body every integration guide shares, rendered from one namespace of copy.
 *
 * Each guide supplies its own `Monitoring`-style namespace with the same keys, so the *shape* of a guide —
 * what it unlocks, what it needs, what it is allowed to do, the steps, verification, what can go wrong, how
 * to disconnect — is the same for all of them and cannot be half-written by accident. The differences are
 * copy and a diagram, which is exactly where they belong.
 */
export function IntegrationGuideBody({
  namespace,
  chain,
  steps,
  failures,
}: {
  /** e.g. `GettingStarted.github`. */
  namespace: string;
  /** How many boxes the chain diagram has, and where its copy lives. */
  chain: { count: number; label: string };
  /** Step ids, in order. Each needs `steps.<id>.title`, `.purpose` and `.body`. */
  steps: readonly string[];
  /** Failure ids. Each needs `failures.<id>.title` and `.fix`. */
  failures: readonly string[];
}) {
  const t = useTranslations(namespace);

  return (
    <>
      <GuideSection id="unlocks" title={t('unlocks.title')} intro={t('unlocks.intro')}>
        <ChainDiagram
          label={chain.label}
          steps={Array.from({ length: chain.count }, (_, index) => ({
            title: t(`chain.${index}.title`),
            detail: t(`chain.${index}.detail`),
          }))}
        />
      </GuideSection>

      <GuideSection id="before" title={t('before.title')} intro={t('before.intro')}>
        <FactGrid
          items={[
            { term: t('before.needTerm'), detail: t('before.needDetail') },
            { term: t('before.costTerm'), detail: t('before.costDetail') },
          ]}
        />
      </GuideSection>

      <GuideSection id="permissions" title={t('permissions.title')} intro={t('permissions.intro')}>
        <FactGrid
          items={[
            { term: t('permissions.grantTerm'), detail: t('permissions.grantDetail') },
            { term: t('permissions.whyTerm'), detail: t('permissions.whyDetail') },
          ]}
        />
        {/* Only guarantees the implementation can actually prove. Each one is enforced by a test. */}
        <Callout title={t('permissions.guaranteeTitle')}>{t('permissions.guaranteeDetail')}</Callout>
      </GuideSection>

      <GuideSection id="steps" title={t('steps.title')}>
        <Method title={t('steps.methodTitle')} intro={t('steps.methodIntro')}>
          {steps.map((id, index) => (
            <Step key={id} id={id} number={index + 1} title={t(`steps.${id}.title`)} purpose={t(`steps.${id}.purpose`)}>
              <p className="max-w-3xl text-sm leading-relaxed text-foreground/85">{t(`steps.${id}.body`)}</p>
            </Step>
          ))}
        </Method>
      </GuideSection>

      <GuideSection id="states" title={t('states.title')} intro={t('states.intro')}>
        <FactGrid
          items={[
            { term: t('states.goodTerm'), detail: t('states.goodDetail') },
            { term: t('states.degradedTerm'), detail: t('states.degradedDetail') },
          ]}
        />
      </GuideSection>

      <GuideSection id="failures" title={t('failures.title')} intro={t('failures.intro')}>
        <dl className="space-y-4">
          {failures.map((id) => (
            <div key={id} className="rounded-xl border p-4">
              <dt className="text-sm font-semibold">{t(`failures.${id}.title`)}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`failures.${id}.fix`)}</dd>
            </div>
          ))}
        </dl>
      </GuideSection>

      <GuideSection id="manage" title={t('manage.title')} intro={t('manage.intro')}>
        <Callout title={t('manage.disconnectTitle')}>{t('manage.disconnectDetail')}</Callout>
      </GuideSection>
    </>
  );
}
