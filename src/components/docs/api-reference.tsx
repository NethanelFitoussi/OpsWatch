import { getTranslations } from 'next-intl/server';
import { API_ERROR_STATUS, type ApiErrorCode } from '@opswatch/contract';
import { CodeBlock } from '@/components/code-block';
import { DocSection } from '@/components/docs/blocks';
import { API_ROUTES } from '@/lib/api/v1/routes';

/**
 * Every endpoint `/api/v1` has, generated from the catalogue the routes themselves are checked against.
 *
 * Written from `API_ROUTES` rather than by hand, because a hand-written reference is a second description
 * of the surface and the two always drift. `tests/unit/api-openapi.test.ts` already holds that catalogue
 * against the route files on disk: a route cannot exist without an entry, and an entry cannot survive its
 * route being deleted. So this page cannot describe an endpoint that is not there, and cannot omit one
 * that is.
 *
 * The prose around it — how to get a token, how paging works, what an error looks like — is in the
 * message catalogue like every other guide, so the French is real translation.
 */

/** The codes every endpoint can answer, listed once rather than on each row. */
const UNIVERSAL: ApiErrorCode[] = ['internal_error'];

export async function ApiReference() {
  const t = await getTranslations('Docs.api');

  const ordered = [...API_ROUTES].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  // Which codes actually appear anywhere, so the table of meanings lists what this build can answer and
  // not every code the contract has ever defined.
  const used = [...new Set([...UNIVERSAL, ...API_ROUTES.flatMap((route) => route.errors)])].sort();

  return (
    <>
      <DocSection title={t('conventionsTitle')}>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">{t('envelope')}</dt>
            <dd className="text-muted-foreground">{t('envelopeBody')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('auth')}</dt>
            <dd className="text-muted-foreground">{t('authBody')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('paging')}</dt>
            <dd className="text-muted-foreground">{t('pagingBody')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('time')}</dt>
            <dd className="text-muted-foreground">{t('timeBody')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('environment')}</dt>
            <dd className="text-muted-foreground">{t('environmentBody')}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <CodeBlock value={t('example')} />
        </div>
      </DocSection>

      <DocSection title={t('errorsTitle')}>
        <p className="text-sm text-muted-foreground">{t('errorsBody')}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t('columns.code')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('columns.status')}</th>
                <th scope="col" className="py-2 font-medium">{t('columns.meaning')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {used.map((code) => (
                <tr key={code}>
                  <th scope="row" className="py-2 pr-4 text-left font-mono text-xs font-normal">{code}</th>
                  <td className="py-2 pr-4 tabular-nums">{API_ERROR_STATUS[code]}</td>
                  <td className="py-2 text-muted-foreground">{t(`errorMeanings.${code}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>

      <DocSection title={t('endpointsTitle')}>
        <p className="text-sm text-muted-foreground">{t('endpointsBody', { count: API_ROUTES.length })}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t('columns.endpoint')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('columns.auth')}</th>
                <th scope="col" className="py-2 font-medium">{t('columns.what')}</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {ordered.map((route) => (
                <tr key={route.operationId}>
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    <span className="font-mono text-xs break-all">
                      <span className="uppercase">{route.method}</span> /api/v1{route.path}
                    </span>
                  </th>
                  <td className="py-2 pr-4 text-xs whitespace-nowrap text-muted-foreground">
                    {route.auth === 'none' ? t('authNone') : t('authSession')}
                  </td>
                  <td className="py-2">
                    <span className="text-muted-foreground">{route.summary}</span>
                    {route.errors.length > 0 && (
                      <span className="mt-1 block font-mono text-[11px] break-all text-muted-foreground/80">
                        {route.errors.join(' · ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t('openapi')}{' '}
          <a href="/api/v1/openapi.json" className="underline underline-offset-4">
            /api/v1/openapi.json
          </a>
        </p>
      </DocSection>
    </>
  );
}
