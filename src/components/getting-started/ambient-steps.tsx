import { ReadOnlyPolicyStep } from './read-only-policy-step';
import { guideTranslators } from './guide-text';
import { Method, Step, SubSteps } from './step-list';

export async function AmbientSteps() {
  const { t, rich, wizard, openAdd, createValues, findRole } = await guideTranslators();
  return (
    <Method id="ambient" title={t('ambient.title')} intro={t('ambient.intro')}>
      <Step number={1} title={t('ambient.steps.s1.title')} purpose={t('ambient.steps.s1.purpose')}>
        <SubSteps items={[{ content: findRole }]} />
      </Step>
      <ReadOnlyPolicyStep guide="ambient" number={2} />
      <Step number={3} title={t('ambient.steps.s3.title')} purpose={t('ambient.steps.s3.purpose')}>
        <SubSteps items={[{ content: rich('ambient.steps.s3.i1') }]} />
      </Step>
      <Step number={4} title={t('ambient.steps.s4.title')} purpose={t('ambient.steps.s4.purpose')}>
        <SubSteps
          items={[
            { content: openAdd },
            { content: rich('ambient.steps.s4.i2', { ...createValues, method: wizard('methods.ambient.title') }) },
            { content: rich('ambient.steps.s4.i3', createValues) },
          ]}
        />
      </Step>
    </Method>
  );
}
