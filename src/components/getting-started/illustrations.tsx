import { CircleCheck, Copy, Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { TEMPLATE_VERSION } from '@/lib/aws/actions';
import {
  Highlight,
  MockButton,
  MockCheckbox,
  MockCode,
  MockField,
  MockFigure,
  MockPanel,
  MockRadio,
  MockSegmented,
  MockUnderlineTabs,
  MockWindow,
  MockWizardFooter,
} from './console-mockup';
import { richTags } from './rich';

const USE_CASES = ['cli', 'local', 'compute', 'thirdParty', 'outside', 'other'] as const;

async function translators() {
  return {
    m: await getTranslations('GettingStarted.mockups'),
    f: await getTranslations('GettingStarted.figures'),
  };
}

export async function CreateUserIllustration({ userName }: { userName: string }) {
  const { m, f } = await translators();
  return (
    <MockFigure caption={f.rich('createUser', richTags)}>
      <MockWindow
        breadcrumb={[m('iam'), m('users'), m('createUser')]}
        title={m('specifyUserDetails')}
        footer={<MockWizardFooter cancel={m('cancel')} primary={m('next')} />}
      >
        <MockPanel title={m('userDetails')}>
          <MockField label={m('userName')} value={userName} />
          <Highlight n={1} className="flex w-full p-2">
            <MockCheckbox checked={false}>{m('consoleAccess')}</MockCheckbox>
          </Highlight>
          <p className="text-[11px] text-muted-foreground">{m('consoleAccessHint')}</p>
        </MockPanel>
      </MockWindow>
    </MockFigure>
  );
}

export async function InlinePolicyIllustration({ userName, policy }: { userName: string; policy: string }) {
  const { m, f } = await translators();
  return (
    <MockFigure caption={f.rich('inlinePolicy', richTags)}>
      <MockWindow
        breadcrumb={[m('iam'), m('users'), userName, m('createPolicy')]}
        title={m('specifyPermissions')}
        footer={<MockWizardFooter cancel={m('cancel')} primary={m('next')} />}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-[13px] font-semibold">{m('policyEditor')}</p>
          <MockSegmented items={[m('visual'), m('json')]} active={1} highlight={1} />
        </div>
        <MockCode lines={policy.split('\n')} />
      </MockWindow>
    </MockFigure>
  );
}

export async function AccessKeyIllustration({ userName }: { userName: string }) {
  const { m, f } = await translators();
  return (
    <MockFigure caption={f.rich('accessKey', richTags)}>
      <MockWindow
        breadcrumb={[m('iam'), m('users'), userName, m('createAccessKey')]}
        title={m('bestPractices')}
        footer={<MockWizardFooter cancel={m('cancel')} primary={m('next')} />}
      >
        <MockPanel title={m('useCase')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {USE_CASES.map((useCase) =>
              useCase === 'outside' ? (
                <Highlight key={useCase} n={1} className="flex">
                  <MockRadio selected>{m(`useCases.${useCase}`)}</MockRadio>
                </Highlight>
              ) : (
                <MockRadio key={useCase} selected={false}>{m(`useCases.${useCase}`)}</MockRadio>
              ),
            )}
          </div>
        </MockPanel>
      </MockWindow>
    </MockFigure>
  );
}

export async function ReviewIllustration() {
  const { m, f } = await translators();
  return (
    <MockFigure caption={f.rich('review', richTags)}>
      <MockWindow
        breadcrumb={[m('cloudformation'), m('stacks'), m('createStack')]}
        title={m('reviewAndCreate')}
        footer={<MockWizardFooter cancel={m('cancel')} extra={<MockButton>{m('previous')}</MockButton>} primary={m('submit')} />}
      >
        <MockPanel title={m('capabilities')}>
          <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-2.5 text-[11px]">
            <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span className="[overflow-wrap:anywhere]">{m('capabilitiesNotice')}</span>
          </p>
          <Highlight n={1} className="flex w-full p-2">
            <MockCheckbox checked>{m('acknowledge')}</MockCheckbox>
          </Highlight>
        </MockPanel>
      </MockWindow>
    </MockFigure>
  );
}

export async function OutputsIllustration({ stackName, roleArn }: { stackName: string; roleArn: string }) {
  const { m, f } = await translators();
  return (
    <MockFigure caption={f.rich('outputs', richTags)}>
      <MockWindow
        breadcrumb={[m('cloudformation'), m('stacks'), stackName]}
        title={stackName}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-3" />
            CREATE_COMPLETE
          </span>
        }
      >
        <MockUnderlineTabs items={[m('stackInfo'), m('events'), m('resources'), m('outputs'), m('parameters')]} active={3} />
        <MockPanel title={m('outputsCount', { count: 2 })}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 text-[11px]">
            <span className="border-b pb-1.5 font-semibold">{m('key')}</span>
            <span className="border-b pb-1.5 font-semibold">{m('value')}</span>
            <div className="col-span-2 my-1.5 grid grid-cols-subgrid items-center rounded-md bg-primary/[0.06] px-2 py-2 ring-1 ring-primary/40">
              <span className="font-mono font-semibold">RoleArn</span>
              <span className="flex items-center gap-3">
                <span className="min-w-0 font-mono break-all">{roleArn}</span>
                <Highlight n={1} className="shrink-0 rounded p-1">
                  <Copy className="size-3.5" />
                </Highlight>
              </span>
            </div>
            <span className="hidden px-2 font-mono text-muted-foreground sm:block">OpsWatchTemplateVersion</span>
            <span className="hidden font-mono text-muted-foreground sm:block">{TEMPLATE_VERSION}</span>
          </div>
        </MockPanel>
      </MockWindow>
    </MockFigure>
  );
}
