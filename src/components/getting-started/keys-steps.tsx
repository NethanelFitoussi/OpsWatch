import { ReadOnlyPolicyStep } from './read-only-policy-step';
import { guideTranslators } from './guide-text';
import { AccessKeyIllustration, CreateUserIllustration } from './illustrations';
import { Method, Step, SubSteps } from './step-list';

// Sample value for illustrations only.
const READ_ONLY_USER = 'opswatch-readonly';

export async function KeysSteps() {
  const { t, rich, wizard, detail, openAdd, createValues } = await guideTranslators();
  return (
    <Method id="keys" title={t('keys.title')} intro={t('keys.intro')}>
      <Step number={1} title={t('keys.steps.s1.title')} purpose={t('keys.steps.s1.purpose')}>
        <SubSteps
          items={[
            { content: rich('keys.steps.s1.i1') },
            { content: rich('keys.steps.s1.i2'), extra: <CreateUserIllustration userName={READ_ONLY_USER} /> },
          ]}
        />
      </Step>
      <ReadOnlyPolicyStep guide="keys" number={2} />
      <Step number={3} title={t('keys.steps.s3.title')} purpose={t('keys.steps.s3.purpose')}>
        <SubSteps
          items={[
            { content: rich('keys.steps.s3.i1'), extra: <AccessKeyIllustration userName={READ_ONLY_USER} /> },
            { content: rich('keys.steps.s3.i2') },
          ]}
        />
      </Step>
      <Step number={4} title={t('keys.steps.s4.title')} purpose={t('keys.steps.s4.purpose')}>
        <SubSteps
          items={[
            { content: openAdd },
            { content: rich('keys.steps.s4.i2', { ...createValues, method: wizard('methods.keys.title') }) },
            {
              content: rich('keys.steps.s4.i3', {
                accessKeyId: detail('keys.accessKeyId'),
                secretAccessKey: detail('keys.secretAccessKey'),
                save: detail('keys.save'),
              }),
            },
            { content: rich('keys.steps.s4.i4') },
          ]}
        />
      </Step>
      <Step number={5} title={t('keys.steps.s5.title')} purpose={t('keys.steps.s5.purpose')}>
        <SubSteps
          items={[
            { content: rich('keys.steps.s5.i1', createValues) },
            { content: rich('keys.steps.s5.i2') },
            { content: rich('keys.steps.s5.i3') },
          ]}
        />
      </Step>
    </Method>
  );
}
