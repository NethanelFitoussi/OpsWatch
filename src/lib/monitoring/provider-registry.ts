import 'server-only';
import type { Provider } from '../connections/types';
import type { ConnectionRow } from '../db/schema';
import { PROVIDER_CAPABILITIES, type MonitoringCapability } from './capabilities';
import { loadFamily } from './overview';
import { AWS_FAMILIES, familiesOf, type AwsFamily } from './shared/families';
import type { AwsTarget, MonitoringDeps, MonitoringScope } from './call';
import type { FamilySummary } from './overview';
import type { MonitoringResult } from './result';
import { listInstances } from './ec2';
import { getMetricSeries } from './metrics';
import { listAlarms } from './alarms';
import { startLogsQuery } from './logs';
import { enabledLogSources } from '../store/errors';
import { instancesInRegion } from '../gcp/instances';
import { instanceCpuSeries } from '../gcp/metrics';
import { projectAlerts } from '../gcp/alerts';
import { gcpTargetFrom, type GcpTarget } from '../gcp/target';
import { listDroplets } from '../do/droplets';
import { dropletBandwidth } from '../do/metrics';
import { doTargetFrom, type DoTarget } from '../do/target';
import { findConnection } from '../connections/repository';
import { getDb } from '../db/client';
import { resolveTarget, type TargetDeps } from './target';

/**
 * What actually backs each provider's declared capabilities.
 *
 * **The seam is `loadFamily`, and nothing downstream moves.** The detect cycle reads each family, and
 * everything after that — `outcomesFromInsights`, the problem lifecycle, `family_snapshots`, the alert
 * cycle, incidents, history, reports — already works on `Insight` and problem rows with no AWS type
 * anywhere in them. `family_snapshots.family` is a plain string; `Insight` carries a kind, a resource,
 * a message key and values. The multi-cloud work is therefore *not* a rewrite of the monitoring
 * application: it is a second and third producer into a pipeline that was already provider-neutral,
 * exactly as the Linux host agent's findings became a second producer into the alert cycle.
 *
 * So a monitoring provider is two things: the families it can read, and a loader per family. This file
 * is the list of who has them, and the guard that a capability declared in `capabilities.ts` is a
 * capability something here can actually serve.
 */

export type FamilyLoader = (
  family: string,
  target: ProviderTarget,
  nowMs: number,
  deps?: MonitoringDeps,
) => Promise<MonitoringResult<FamilySummary>>;

/**
 * What a loader is given, tagged by the cloud it is for.
 *
 * The three are genuinely unalike and are not being forced into one shape: AWS's is a set of assumed
 * role credentials for one region, Google's is a signing key plus the pool that will exchange it for a
 * token, and DigitalOcean's is an account-wide token with no region in it at all. Pretending otherwise
 * — a `credentials` field every provider fills differently — is how the AWS model gets cloned under
 * generic names. The tag is what the loader narrows on, and each arm says what that cloud actually needs.
 */
export type ProviderTarget = ({ provider: 'aws' } & AwsTarget) | GcpTarget | DoTarget;

/**
 * How a provider turns a connection into the material for a call.
 *
 * Provider-aware because it has to be: the detect cycle called AWS's `sts:AssumeRole` resolver for
 * every connection regardless of cloud, which was harmless only while no other provider had families
 * to read. The first Google family would have made every Google cycle throw `connection_unavailable`
 * — a connection reported as unreachable when nothing had been attempted.
 */
export type TargetResolver = (scope: MonitoringScope, deps?: TargetDeps) => Promise<MonitoringResult<ProviderTarget>>;

/** Looks the row up the way AWS's resolver does, so all three fail the same way when there is no row. */
function fromRow(action: string, resolve: (row: ConnectionRow, scope: MonitoringScope, deps: TargetDeps) => MonitoringResult<ProviderTarget>): TargetResolver {
  return (scope, deps = {}) => {
    const row = findConnection(deps.db ?? getDb(), scope.connectionId);
    if (!row) return Promise.resolve({ ok: false, reason: 'error', code: 'ConnectionNotFound', action });
    return Promise.resolve(resolve(row, scope, deps));
  };
}

/**
 * A reader a capability needs before it may be declared.
 *
 * Only its presence is checked, never called from the guard: the point is that a promise in the
 * capability table has a named piece of code behind it. Without this the guard was real for `health`
 * and `problems` and a rubber stamp for the other six — a provider could have declared `metrics:
 * supported` with no metrics code anywhere and passed a test whose name says it cannot.
 */
export type CapabilityReader = (...args: never[]) => unknown;

export type MonitoringProvider = {
  provider: Provider;
  /**
   * The families this provider's health and problems are computed over.
   *
   * Empty means it has none yet, which is what `health: not_built` says in the capability table — and
   * the guard below refuses the combination of an empty list and a claim of support.
   */
  families: readonly string[];
  loadFamily: FamilyLoader | null;
  /** Null where nothing can be read yet, which the guard ties to having no families. */
  resolveTarget: TargetResolver | null;
  /**
   * What serves each of the remaining capabilities, or null where nothing does.
   *
   * `health` and `problems` are not here: both are computed from families, so what backs them is the
   * loader above and listing them again would be two places to keep in step.
   */
  readers: {
    resources: CapabilityReader | null;
    metrics: CapabilityReader | null;
    errors: CapabilityReader | null;
    alerts: CapabilityReader | null;
    logs: CapabilityReader | null;
    history: CapabilityReader | null;
  };
};

const AWS: MonitoringProvider = {
  provider: 'aws',
  families: AWS_FAMILIES,
  readers: {
    resources: listInstances,
    metrics: getMetricSeries,
    errors: enabledLogSources,
    alerts: listAlarms,
    logs: startLogsQuery,
    // History is metrics, kept: the job that writes it reads through the same series call.
    history: getMetricSeries,
  },
  // The AssumeRole resolver the ninety-odd AWS pages already call, tagged on its way through here.
  // Untouched: it is correct for AWS, and the fix was never to change it but to stop calling it for
  // clouds it knows nothing about.
  resolveTarget: async (scope, deps) => {
    const resolved = await resolveTarget(scope, deps);
    return resolved.ok ? { ok: true, data: { provider: 'aws', ...resolved.data } } : resolved;
  },
  // The existing loader, unchanged and unwrapped in any meaningful sense: the families it serves are
  // the ones it has always served, and the detect cycle calls it through here instead of directly.
  loadFamily: (family, target, nowMs, deps) => {
    if (!isAwsFamily(family)) return Promise.resolve(unknownFamily(family));
    // Narrowed rather than asserted: a Google target reaching the AWS loader is a bug worth a refusal.
    if (target.provider !== 'aws') return Promise.resolve(wrongTarget('aws', target.provider));
    return loadFamily(family, target, nowMs, deps);
  },
};

const isAwsFamily = (family: string): family is AwsFamily => (AWS_FAMILIES as readonly string[]).includes(family);

/**
 * A family this provider does not have.
 *
 * Defensive: the detect cycle iterates the provider's own list, so nothing should ask. If something
 * does, it is a refusal — never an empty summary, which the pipeline would record as "read, and
 * nothing wrong". `FailureReason` stays the closed set of three it is everywhere else; the code says
 * which family it was.
 */
const unknownFamily = (family: string): MonitoringResult<FamilySummary> => ({
  ok: false,
  reason: 'error',
  code: 'unsupported_family',
  action: `loadFamily:${family}`,
});

/** A target for the wrong cloud. Refused for the same reason: an empty summary would read as healthy. */
const wrongTarget = (expected: Provider, got: Provider): MonitoringResult<FamilySummary> => ({
  ok: false,
  reason: 'error',
  code: 'wrong_target_provider',
  action: `loadFamily:${expected}:${got}`,
});

export const MONITORING_PROVIDERS: Record<Provider, MonitoringProvider> = {
  aws: AWS,
  // Connected, and read only for its resource list so far. The capability table says `not_built`
  // rather than pretending otherwise, and this says the same thing in code.
  gcp: {
    provider: 'gcp',
    families: familiesOf('gcp'),
    loadFamily: null,
    resolveTarget: fromRow('gcp:federation', (row, scope, deps) => gcpTargetFrom(row, scope.region, { secret: deps.secret })),
    readers: { resources: instancesInRegion, metrics: instanceCpuSeries, errors: null, alerts: projectAlerts, logs: null, history: null },
  },
  do: {
    provider: 'do',
    families: familiesOf('do'),
    loadFamily: null,
    // The scope's region is not passed on, because DigitalOcean's API has no per-region endpoint to
    // pass it to. Inventing one would be parity DigitalOcean does not offer.
    resolveTarget: fromRow('do:token', (row, _scope, deps) => doTargetFrom(row, deps.secret)),
    readers: { resources: listDroplets, metrics: dropletBandwidth, errors: null, alerts: null, logs: null, history: null },
  },
};

export const monitoringProvider = (provider: Provider): MonitoringProvider => MONITORING_PROVIDERS[provider];

/**
 * Whether a declared capability has something behind it.
 *
 * Used by the guard rather than at run time: the point is that a table of promises and the code that
 * keeps them cannot drift apart silently, which is how a product ends up claiming support it does not
 * have — the failure this codebase calls an unearned green.
 */
export function capabilityIsBacked(provider: Provider, capability: MonitoringCapability): boolean {
  const declared = PROVIDER_CAPABILITIES[provider][capability];
  if (declared.state !== 'supported') return true;
  const implementation = MONITORING_PROVIDERS[provider];
  switch (capability) {
    // Health and problems are both computed from families, so both need at least one and a loader.
    case 'health':
    case 'problems':
      // A loader with no way to get a target is a capability that fails on first use, which is the
      // same unearned green as no loader at all.
      return implementation.families.length > 0 && implementation.loadFamily !== null && implementation.resolveTarget !== null;
    default:
      // Everything else names the reader that serves it. A declaration with nothing behind it is the
      // unearned green this product treats as a defect, and it fails here rather than on a page.
      return implementation.readers[capability] !== null;
  }
}
