import { PROVIDERS, type Provider } from '../connections/types';

/**
 * What OpsWatch can do with a cloud, declared per provider.
 *
 * **Client-safe and data, not code.** The pages that decide which sections a connection has read this,
 * so a connection to a provider that has no logs does not get a Logs page that then apologises. The
 * old check was `provider === 'aws'`, which was true and told nobody anything.
 *
 * Two kinds of "no", because they are different sentences and lead to different actions:
 *
 *   - `not_offered` — the provider does not expose it. DigitalOcean has no equivalent of CloudWatch
 *     Logs Insights, and no amount of work at this end will produce one. An operator who reads that
 *     stops looking.
 *   - `not_built` — OpsWatch has not done it yet. The provider offers it. An operator who reads that
 *     knows it may arrive, and knows not to conclude their cloud cannot do it.
 *
 * Saying "unsupported" for both would be true and useless.
 */

export const MONITORING_CAPABILITIES = [
  /** A list of what exists: instances, droplets, services, databases. */
  'resources',
  /** A verdict per family, and the distinction between healthy and not-measured. */
  'health',
  /** Figures over time, from the provider's own monitoring. */
  'metrics',
  /** OpsWatch's own detection: what is wrong, since when, and with what evidence. */
  'problems',
  /** Application errors, grouped and counted. */
  'errors',
  /** The provider's own alarms or alerting policies, read as evidence. */
  'alerts',
  /** Log search. */
  'logs',
  /** Figures kept beyond the provider's own retention, for baselines and objectives. */
  'history',
] as const;
export type MonitoringCapability = (typeof MONITORING_CAPABILITIES)[number];

/**
 * How the data reaches OpsWatch.
 *
 * `direct` is OpsWatch calling the provider's API with a credential the operator gave it, and it is
 * the default and the only one that is ever required. `managed` is the provider pushing to OpsWatch —
 * the AWS forwarder — and it is always something an operator switched on, never a condition of
 * connecting. A self-hosted instance that never enables one must still be able to monitor, which is
 * why no capability here is `managed` only.
 */
export const CAPABILITY_MODES = ['direct', 'managed'] as const;
export type CapabilityMode = (typeof CAPABILITY_MODES)[number];

export type CapabilitySupport =
  | { state: 'supported'; modes: readonly CapabilityMode[] }
  | { state: 'not_offered' }
  | { state: 'not_built' };

export type ProviderCapabilities = Record<MonitoringCapability, CapabilitySupport>;

const direct: CapabilitySupport = { state: 'supported', modes: ['direct'] };
const directOrManaged: CapabilitySupport = { state: 'supported', modes: ['direct', 'managed'] };

/**
 * What each provider can do, today.
 *
 * Every `supported` here is checked against an implementation by `monitoring-capabilities.test.ts`:
 * a capability claimed and not built is the "unearned green" this product treats as a defect, and a
 * declaration is exactly the kind of thing that drifts away from the code that was supposed to back it.
 */
export const PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  aws: {
    resources: direct,
    health: direct,
    metrics: direct,
    problems: direct,
    // Read directly from Logs Insights, or forwarded by the optional collection stack.
    errors: directOrManaged,
    alerts: direct,
    logs: directOrManaged,
    history: direct,
  },
  gcp: {
    resources: direct,
    /*
     * Not built, and `problems` below is. They are not the same claim: Health is a per-family verdict
     * on an estate, and the section rail that shows it is ten AWS services — offering it for a Google
     * project would put Containers, Databases and Load balancers in front of somebody who has none.
     * Google's problems appear on the cross-cloud page instead, which needs no rail.
     */
    health: { state: 'not_built' },
    // Agentless CPU utilisation from Cloud Monitoring, read straight from the project. Memory and disk
    // usage are not here because on Google they are not agentless — they come from `agent.googleapis.com`
    // and exist only where the Ops Agent is installed, which OpsWatch does not install.
    metrics: direct,
    // Incidents Google opened, turned into OpsWatch problems with their whole lifecycle — they
    // resolve when Google closes them, they raise alerts, and they appear beside AWS's on `/problems`.
    problems: direct,
    errors: { state: 'not_built' },
    // Cloud Monitoring's alerting policies and open incidents, read directly. Google's verdicts, not
    // OpsWatch's: nothing here is a health conclusion this product reached on its own.
    alerts: direct,
    logs: { state: 'not_built' },
    history: { state: 'not_built' },
  },
  do: {
    resources: direct,
    health: { state: 'not_built' },
    // Public bandwidth, read straight from the account. Not CPU: on DigitalOcean that comes from
    // `do-agent` inside the droplet, the opposite way round from Google — so this is deliberately a
    // narrower claim than the Google one, and the droplets page says which figures need the agent.
    metrics: direct,
    problems: { state: 'not_built' },
    // DigitalOcean has no log product to read application errors out of. This is not a gap in OpsWatch.
    errors: { state: 'not_offered' },
    /*
     * Its alert **policies**, which is all DigitalOcean exposes. There is no endpoint at all that
     * says which of them are currently firing — Google has one, AWS has alarm state, DigitalOcean has
     * neither — so this capability means something different here, and the page says which.
     */
    alerts: direct,
    logs: { state: 'not_offered' },
    history: { state: 'not_built' },
  },
};

export const capabilitiesOf = (provider: Provider): ProviderCapabilities => PROVIDER_CAPABILITIES[provider];

export const supports = (provider: Provider, capability: MonitoringCapability): boolean =>
  PROVIDER_CAPABILITIES[provider][capability].state === 'supported';

/** Which providers can do this, for a page that asks the question the other way round. */
export const providersSupporting = (capability: MonitoringCapability): Provider[] =>
  PROVIDERS.filter((provider) => supports(provider, capability));
