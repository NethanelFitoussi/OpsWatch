import { CodeBlock } from '@/components/code-block';
import { readOnlyPolicyDocument } from '@/lib/aws/actions';
import { guideTranslators, json } from './guide-text';
import { Step, SubSteps } from './step-list';

/** "Grant the read-only policy", shared by the ambient and access key guides. */
export async function ReadOnlyPolicyStep({ guide, number }: { guide: 'ambient' | 'keys'; number: number }) {
  const { t, rich } = await guideTranslators();
  return (
    <Step
      number={number}
      title={t(`${guide}.steps.s${number}.title`)}
      purpose={rich('shared.readOnlyPurpose', { servicesTitle: t('servicesTitle') })}
    >
      <SubSteps
        items={[
          { content: rich(`${guide}.steps.s${number}.i1`) },
          {
            content: rich('shared.pasteReadOnly'),
            extra: <CodeBlock label={t('shared.readOnlyPolicyLabel')} value={json(readOnlyPolicyDocument())} />,
          },
        ]}
      />
    </Step>
  );
}
