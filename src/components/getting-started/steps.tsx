import { Globe } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BASE_IDENTITY_POLICY, ROLE_NAME_PREFIX, readOnlyPolicyDocument } from '@/lib/aws/actions';
import { roleArnFor, stackNameFor } from '@/lib/aws/template';
import { Callout } from './callout';
import { CodeBlock } from '@/components/code-block';
import {
  AccessKeyIllustration,
  CreateUserIllustration,
  InlinePolicyIllustration,
  OutputsIllustration,
  ReviewIllustration,
} from './illustrations';
import { richTags } from './rich';
import { Method, Step, SubSection, SubSteps } from './step-list';

// Sample values for illustrations and examples only.
const SAMPLE_ACCOUNT_ID = '123456789012';
const SAMPLE_CONNECTION_ID = '3f9c2a7b1d4e';
const IDENTITY_USER = 'opswatch';
const READ_ONLY_USER = 'opswatch-readonly';
const ENV_EXAMPLE = ['AWS_ACCESS_KEY_ID=AKIA…', 'AWS_SECRET_ACCESS_KEY=…', 'AWS_REGION=eu-west-1'].join('\n');

const json = (value: unknown) => JSON.stringify(value, null, 2);

export async function Steps() {
  const t = await getTranslations('GettingStarted');
  const nav = await getTranslations('Common.nav');
  const accounts = await getTranslations('Accounts');
  const wizard = await getTranslations('Wizard');
  const detail = await getTranslations('AccountDetail');
  const checklist = await getTranslations('Checklist');

  const basePolicy = json(BASE_IDENTITY_POLICY);
  const readOnlyPolicy = json(readOnlyPolicyDocument());
  const rich = (key: string, values: Record<string, string | number> = {}) => t.rich(key, { ...richTags, ...values });

  const openAdd = rich('shared.openAdd', { accounts: nav('accounts'), add: accounts('add') });
  const createValues = {
    name: wizard('name'),
    accountId: wizard('accountId'),
    regions: wizard('regions'),
    submit: wizard('submit'),
    run: checklist('run'),
  };
  const basePolicyBlock = <CodeBlock label={t('role.steps.s0.policyLabel')} value={basePolicy} />;
  const readOnlyPolicyBlock = <CodeBlock label={t('shared.readOnlyPolicyLabel')} value={readOnlyPolicy} />;
  const findRole = rich('role.steps.s0.aws.i1');

  return (
    <div className="space-y-16">
      <Method title={t('role.title')}>
        <Step id="step-0" number={0} title={t('role.steps.s0.title')} purpose={t('role.steps.s0.purpose')}>
          <Tabs defaultValue="server" className="gap-5">
            <TabsList className="h-auto w-full flex-col items-stretch group-data-horizontal/tabs:h-auto sm:w-fit sm:flex-row">
              <TabsTrigger value="server" className="px-3 py-1.5 whitespace-normal">{t('role.steps.s0.tabs.server')}</TabsTrigger>
              <TabsTrigger value="aws" className="px-3 py-1.5 whitespace-normal">{t('role.steps.s0.tabs.aws')}</TabsTrigger>
            </TabsList>
            <TabsContent value="server">
              <SubSteps
                items={[
                  { content: rich('role.steps.s0.server.i1') },
                  { content: rich('role.steps.s0.server.i2'), extra: <CreateUserIllustration userName={IDENTITY_USER} /> },
                  { content: rich('role.steps.s0.server.i3') },
                  {
                    content: rich('role.steps.s0.server.i4'),
                    extra: (
                      <>
                        {basePolicyBlock}
                        <InlinePolicyIllustration userName={IDENTITY_USER} policy={basePolicy} />
                      </>
                    ),
                  },
                  { content: rich('role.steps.s0.server.i5'), extra: <AccessKeyIllustration userName={IDENTITY_USER} /> },
                  {
                    content: rich('role.steps.s0.server.i6'),
                    extra: (
                      <>
                        <CodeBlock label={t('role.steps.s0.server.envLabel')} value={ENV_EXAMPLE} />
                        <Callout variant="warning" title={t('role.steps.s0.server.profileTitle')}>
                          {rich('role.steps.s0.server.profile')}
                        </Callout>
                      </>
                    ),
                  },
                  { content: rich('role.steps.s0.server.i7', { identityTitle: detail('role.identityTitle') }) },
                ]}
              />
            </TabsContent>
            <TabsContent value="aws">
              <SubSteps
                items={[
                  { content: findRole },
                  { content: rich('role.steps.s0.aws.i2'), extra: basePolicyBlock },
                  { content: rich('role.steps.s0.aws.i3') },
                ]}
              />
            </TabsContent>
          </Tabs>
          <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
            <Callout title={t('role.steps.s0.sso.title')}>{rich('role.steps.s0.sso.body')}</Callout>
            <Callout title={t('role.steps.s0.ownKey.title')}>
              {rich('role.steps.s0.ownKey.body', { rolePattern: `${ROLE_NAME_PREFIX}*` })}
            </Callout>
          </div>
        </Step>

        <Step id="step-1" number={1} title={t('role.steps.s1.title')} purpose={t('role.steps.s1.purpose')}>
          <SubSteps
            items={[
              { content: openAdd },
              { content: rich('role.steps.s1.i2', { method: wizard('methods.role.title') }) },
              { content: rich('role.steps.s1.i3', createValues) },
              { content: rich('role.steps.s1.i4', createValues) },
            ]}
          />
        </Step>

        <Step id="step-2" number={2} title={t('role.steps.s2.title')} purpose={t('role.steps.s2.purpose')}>
          <p className="flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
            <Globe className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('role.steps.s2.region')}
          </p>
          <div className="max-w-3xl space-y-4">
            <SubSection title={t('role.steps.s2.console.title')}>
              <SubSteps
                items={[
                  { content: rich('role.steps.s2.console.i1', { download: detail('role.download') }) },
                  { content: rich('role.steps.s2.console.i2') },
                  { content: rich('role.steps.s2.console.i3') },
                  { content: rich('role.steps.s2.console.i4', { stackName: stackNameFor(`<${t('shared.placeholderId')}>`) }) },
                  { content: rich('role.steps.s2.console.i5'), extra: <ReviewIllustration /> },
                  { content: rich('role.steps.s2.console.i6') },
                ]}
              />
            </SubSection>
            <SubSection title={t('role.steps.s2.cli.title')}>
              <SubSteps
                items={[
                  { content: rich('role.steps.s2.cli.i1', { download: detail('role.download') }) },
                  { content: rich('role.steps.s2.cli.i2') },
                ]}
              />
            </SubSection>
            <SubSection title={t('role.steps.s2.launch.title')}>
              <p className="text-sm text-muted-foreground">{rich('role.steps.s2.launch.note')}</p>
              <SubSteps
                items={[
                  { content: rich('role.steps.s2.launch.i1', { launchStack: detail('role.launchStack') }) },
                  { content: rich('role.steps.s2.launch.i2') },
                ]}
              />
            </SubSection>
          </div>
        </Step>

        <Step id="step-3" number={3} title={t('role.steps.s3.title')} purpose={t('role.steps.s3.purpose')}>
          <SubSteps
            items={[
              {
                content: rich('role.steps.s3.i1', { example: roleArnFor(SAMPLE_ACCOUNT_ID, '<id>') }),
                extra: (
                  <OutputsIllustration
                    stackName={stackNameFor(SAMPLE_CONNECTION_ID)}
                    roleArn={roleArnFor(SAMPLE_ACCOUNT_ID, SAMPLE_CONNECTION_ID)}
                  />
                ),
              },
              { content: rich('role.steps.s3.i2', { roleArnLabel: detail('role.roleArnLabel'), save: detail('role.saveRoleArn') }) },
            ]}
          />
        </Step>

        <Step id="step-4" number={4} title={t('role.steps.s4.title')} purpose={t('role.steps.s4.purpose')}>
          <SubSteps
            items={[
              { content: rich('role.steps.s4.i1', createValues) },
              {
                content: t('role.steps.s4.i2'),
                extra: (
                  <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                    {(
                      [
                        ['green', 'bg-emerald-500', checklist('statuses.ok')],
                        ['orange', 'bg-amber-500', checklist('statuses.denied')],
                        ['red', 'bg-red-500', ''],
                      ] as const
                    ).map(([key, dot, status]) => (
                      <li key={key} className="flex gap-3 p-3">
                        <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
                        <span>
                          {rich(`role.steps.s4.${key}`, {
                            status,
                            servicesTitle: t('servicesTitle'),
                            troubleshootingTitle: t('troubleshooting.title'),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </Step>
      </Method>

      <Method id="ambient" title={t('ambient.title')} intro={t('ambient.intro')}>
        <Step number={1} title={t('ambient.steps.s1.title')} purpose={t('ambient.steps.s1.purpose')}>
          <SubSteps items={[{ content: findRole }]} />
        </Step>
        <Step number={2} title={t('ambient.steps.s2.title')} purpose={rich('shared.readOnlyPurpose', { servicesTitle: t('servicesTitle') })}>
          <SubSteps
            items={[
              { content: rich('ambient.steps.s2.i1') },
              { content: rich('shared.pasteReadOnly'), extra: readOnlyPolicyBlock },
            ]}
          />
        </Step>
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

      <Method id="keys" title={t('keys.title')} intro={t('keys.intro')}>
        <Step number={1} title={t('keys.steps.s1.title')} purpose={t('keys.steps.s1.purpose')}>
          <SubSteps
            items={[
              { content: rich('keys.steps.s1.i1') },
              { content: rich('keys.steps.s1.i2'), extra: <CreateUserIllustration userName={READ_ONLY_USER} /> },
            ]}
          />
        </Step>
        <Step number={2} title={t('keys.steps.s2.title')} purpose={rich('shared.readOnlyPurpose', { servicesTitle: t('servicesTitle') })}>
          <SubSteps
            items={[
              { content: rich('keys.steps.s2.i1') },
              { content: rich('shared.pasteReadOnly'), extra: readOnlyPolicyBlock },
            ]}
          />
        </Step>
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
    </div>
  );
}
