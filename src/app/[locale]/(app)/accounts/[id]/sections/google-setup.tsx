import { getFormatter, getTranslations } from 'next-intl/server';
import { CodeBlock } from '@/components/code-block';
import { Link } from '@/i18n/navigation';
import { SectionCard } from '@/components/section-card';
import { TONE_TEXT } from '@/lib/ui/tones';
import { GCP_ROLES } from '@/lib/gcp/check';
import { providerResourceName } from '@/lib/gcp/federation';
import { issuerUrl, jwkSet, openConnectionKey } from '@/lib/gcp/issuer';
import type { ConnectionRow } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { VerifyGoogleForm } from '../forms';
import { verifyGoogleAction } from '../../actions';

/**
 * Connecting a Google Cloud project, without giving OpsWatch a Google credential.
 *
 * The order is the point. What OpsWatch will be able to read is stated **first**, in the roles an
 * operator will recognise, before anything is asked of them — a page that asks for access and explains
 * afterwards is asking somebody to agree to something they have not read.
 *
 * Then what it will not have: no service account key, nothing to leak, nothing to rotate. Google's own
 * guidance is to avoid those keys, and the reason it gives is that "there is no reliable way to tell
 * who used the key". Every call OpsWatch makes here is attributable to this connection.
 *
 * The commands are shown, never run. OpsWatch has no credential in this project and will not have one:
 * the operator runs these in their own shell, with their own identity, and the audit entry in Google is
 * theirs.
 */
export async function GoogleSetup({ row, locale, baseUrl }: { row: ConnectionRow; locale: string; baseUrl: string | undefined }) {
  const t = await getTranslations('GoogleSetup');
  const format = await getFormatter();
  const key = row.gcpKeyCiphertext === null ? null : openConnectionKey(row.gcpKeyCiphertext, process.env.OPSWATCH_SECRET ?? '');

  const target = {
    projectNumber: row.gcpProjectNumber ?? '',
    poolId: row.gcpPoolId ?? '',
    providerId: row.gcpProviderId ?? '',
    serviceAccount: row.gcpServiceAccount,
  };
  const issuer = baseUrl === undefined ? null : issuerUrl(baseUrl, row.id);
  const result = row.gcpLastTest;

  const poolCommand = [
    `gcloud iam workload-identity-pools create ${target.poolId} \\`,
    `  --project=${row.gcpProjectId} \\`,
    '  --location=global \\',
    '  --display-name="OpsWatch"',
  ].join('\n');

  // `--jwk-json-path` rather than `--issuer-uri` discovery: it is what lets an instance nobody can
  // reach from the internet use the method Google recommends.
  const providerCommand = [
    `gcloud iam workload-identity-pools providers create-oidc ${target.providerId} \\`,
    `  --project=${row.gcpProjectId} \\`,
    '  --location=global \\',
    `  --workload-identity-pool=${target.poolId} \\`,
    `  --issuer-uri="${issuer ?? ''}" \\`,
    '  --jwk-json-path=opswatch-keys.json \\',
    '  --attribute-mapping="google.subject=assertion.sub"',
  ].join('\n');

  const principal = `principal://iam.googleapis.com/projects/${target.projectNumber}/locations/global/workloadIdentityPools/${target.poolId}/subject/${row.id}`;
  const grantCommands = GCP_ROLES.map((role) =>
    target.serviceAccount === null
      ? `gcloud projects add-iam-policy-binding ${row.gcpProjectId} \\\n  --member="${principal}" \\\n  --role="${role}"`
      : `gcloud projects add-iam-policy-binding ${row.gcpProjectId} \\\n  --member="serviceAccount:${target.serviceAccount}" \\\n  --role="${role}"`,
  ).join('\n\n');

  const impersonationCommand =
    target.serviceAccount === null
      ? null
      : [
          `gcloud iam service-accounts add-iam-policy-binding ${target.serviceAccount} \\`,
          `  --project=${row.gcpProjectId} \\`,
          `  --member="${principal}" \\`,
          '  --role="roles/iam.workloadIdentityUser"',
        ].join('\n');

  return (
    <>
      {/* Before anything is asked for: what this will be able to read. */}
      <SectionCard title={t('accessTitle')} description={t('accessHint')}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {GCP_ROLES.map((role) => (
            <li key={role}>
              <code className="font-mono text-xs">{role}</code> — {t(`roles.${role === 'roles/compute.viewer' ? 'compute' : 'monitoring'}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-medium">{t('noKeyTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('noKeyHint')}</p>
      </SectionCard>

      <SectionCard step={1} title={t('keysTitle')} description={t('keysHint')} contentClassName="space-y-3">
        {key === null ? (
          // A key that cannot be opened is a changed OPSWATCH_SECRET, and saying so beats an empty box.
          <p className="text-sm text-destructive">{t('noKey')}</p>
        ) : (
          <>
            <CodeBlock value={JSON.stringify(jwkSet(key), null, 2)} />
            <p className="text-sm text-muted-foreground">{t('keysSaveAs')}</p>
            {issuer !== null && <p className="text-sm text-muted-foreground">{t('keysOrFetch', { url: `${issuer}/jwks.json` })}</p>}
          </>
        )}
      </SectionCard>

      <SectionCard step={2} title={t('poolTitle')} description={t('poolHint')} contentClassName="space-y-4">
        <CodeBlock value={poolCommand} />
        <CodeBlock value={providerCommand} />
        {issuer === null && <p className="text-sm text-destructive">{t('noPublicUrl')}</p>}
      </SectionCard>

      <SectionCard step={3} title={t('grantTitle')} description={t('grantHint')} contentClassName="space-y-4">
        {impersonationCommand !== null && <CodeBlock value={impersonationCommand} />}
        <CodeBlock value={grantCommands} />
      </SectionCard>

      {/* Once something can be read, the way to it. Only then: a link to a page that would refuse is
          not a way in, it is a dead end with a label on it. */}
      {result?.federation === null && result.checks.some((check) => check.check === 'compute' && check.status === 'ok') && (
        <SectionCard title={t('instances')} description={t('instancesHint')}>
          <Link href={`/accounts/${row.id}/instances`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('instances')}
          </Link>
        </SectionCard>
      )}

      <SectionCard step={4} title={t('verifyTitle')} description={t('verifyHint')} contentClassName="space-y-3">
        <p className="text-xs break-all text-muted-foreground">
          {t('audience')}: <code className="font-mono">{providerResourceName(target)}</code>
        </p>
        <VerifyGoogleForm action={verifyGoogleAction.bind(null, locale, row.id)} />

        {result === null || result === undefined ? (
          // Never tested is not the same as tested and failing, and must not be shown as either.
          <p className="text-sm text-muted-foreground">{t('neverTested')}</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('testedAt', { when: format.relativeTime(new Date(result.testedAt)) })}</p>
            {result.federation !== null ? (
              <>
                <p className={cn('text-sm font-medium', TONE_TEXT.danger)}>{t(`federation.${result.federation}`)}</p>
                {/* Google's own words, shown as theirs: it is usually the sentence that says which
                    field is wrong, and paraphrasing it would lose that. */}
                {result.detail !== undefined && <p className="text-xs text-muted-foreground">{result.detail}</p>}
              </>
            ) : (
              <ul className="space-y-1 text-sm">
                {result.checks.map((check) => (
                  <li key={check.check}>
                    <span className={cn('font-medium', check.status === 'ok' ? TONE_TEXT.success : TONE_TEXT.danger)}>
                      {t(`checks.${check.check}`)}: {t(`status.${check.status}`)}
                    </span>
                    {check.detail !== undefined && <span className="block text-xs text-muted-foreground">{check.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SectionCard>
    </>
  );
}
