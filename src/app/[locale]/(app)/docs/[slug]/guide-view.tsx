import { getTranslations } from 'next-intl/server';
import { DocBody, DocCallout, DocFlow, DocNext, DocProblem, DocSection, DocStep } from '@/components/docs/blocks';
import { docPath, findGuide, type DocGuide } from '@/lib/docs/catalogue';

/**
 * One guide, rendered from its message tree.
 *
 * The structure is the same for every guide and the prose is entirely in the catalogues, which is what
 * makes the French real rather than an English page with a French heading. A guide that wants a diagram
 * declares its boxes as messages too; a guide that does not simply has none.
 */

type Step = { title: string; body?: string; command?: string };
type Problem = { q: string; a: string };
type NextLink = { href: string; label: string };

/** Message objects arrive as keyed maps, because the catalogue's type has no arrays. */
function listOf<T>(value: unknown): T[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.keys(value as Record<string, T>)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (value as Record<string, T>)[key]);
}

export async function GuideView({ guide }: { guide: DocGuide }) {
  const t = await getTranslations(`Docs.guides.${guide.slug}`);
  const common = await getTranslations('Docs');

  const before = listOf<string>(t.raw('before'));
  const steps = listOf<Step>(t.raw('steps'));
  const problems = listOf<Problem>(t.raw('problems'));
  const next = listOf<NextLink>(t.raw('next'));
  const flow = listOf<{ label: string; note?: string }>(t.raw('flow'));

  return (
    <DocBody>
      <DocSection title={common('whatThisDoes')}>
        <p className="text-sm">{t('what')}</p>
        {flow.length > 0 && <DocFlow steps={flow} label={t('title')} />}
      </DocSection>

      {before.length > 0 && (
        <DocSection title={common('beforeYouStart')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {before.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </DocSection>
      )}

      {steps.length > 0 && (
        <DocSection title={common('steps')}>
          <ol className="space-y-4">
            {steps.map((step, index) => (
              <DocStep key={step.title} index={index + 1} title={step.title} command={step.command}>
                {step.body}
              </DocStep>
            ))}
          </ol>
        </DocSection>
      )}

      <DocSection title={common('howToVerify')}>
        <DocCallout kind="tip">{t('verify')}</DocCallout>
      </DocSection>

      {problems.length > 0 && (
        <DocSection title={common('commonProblems')}>
          <div className="space-y-2">
            {problems.map((problem) => (
              <DocProblem key={problem.q} question={problem.q}>
                {problem.a}
              </DocProblem>
            ))}
          </div>
        </DocSection>
      )}

      <DocSection title={common('nextStep')}>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {guide.appHref !== undefined && <DocNext href={guide.appHref} label={common('openInApp')} />}
          {next.map((link) => (
            <DocNext key={link.href} href={findGuide(link.href) === null ? link.href : docPath(link.href)} label={link.label} />
          ))}
        </div>
      </DocSection>
    </DocBody>
  );
}
