/**
 * Linux hosts, and what an agent on one reports.
 *
 * **Why an agent rather than SSH.** A monitoring tool that reaches into machines needs a credential that
 * can log in to them, network reachability to every one, and a schedule of its own — and it still only
 * sees each host at the moments it looks. An agent the operator installs needs none of that: it runs
 * where the data is, it reaches out rather than being reached, so a host behind NAT works like any
 * other, and OpsWatch never holds a credential that could change anything on the machine. The one it
 * does hold signs reports; it cannot open a shell.
 *
 * **Why a host is not inside an AWS connection.** A Linux machine may be an EC2 instance, a Droplet, a
 * Compute Engine VM or a server under somebody's desk. Filing it under an AWS account and region would
 * make the cloud the thing and the machine an attribute of it, which is backwards: the provider is
 * provenance, and the resource is what an operator investigates. Where a host *is* an EC2 instance,
 * that is a fact the host reports about itself, and the two are matched on identity AWS gave it — never
 * on a hostname, which two machines can share.
 */
import { z } from 'zod';
import { epochSchema, idSchema, lenientEnum, nullableNumberSchema } from './primitives';

/** Where a host runs, as the machine itself reports. `unknown` is honest and common. */
export const HOST_CLOUDS = ['aws', 'gcp', 'digitalocean', 'unknown'] as const;
export type HostCloud = (typeof HOST_CLOUDS)[number];
export const hostCloudSchema = lenientEnum(HOST_CLOUDS, 'unknown');

/**
 * What OpsWatch can say about a host right now.
 *
 * `waiting` is its own state and not a failure: a host that was enrolled a minute ago and whose agent
 * has not run yet is not unhealthy, and calling it so would train an operator to ignore the colour.
 * `stale` is the one that matters — an agent that reported and then stopped is a machine OpsWatch can
 * say nothing current about, which is different from a machine that is fine.
 */
export const HOST_STATES = ['waiting', 'healthy', 'stale', 'unknown'] as const;
export type HostState = (typeof HOST_STATES)[number];
export const hostStateSchema = lenientEnum(HOST_STATES, 'unknown');

/** One mounted filesystem. Sizes are `null` where the agent could not read them, never 0. */
export const hostDiskSchema = z.object({
  mount: z.string(),
  usedBytes: nullableNumberSchema,
  totalBytes: nullableNumberSchema,
});
export type HostDisk = z.infer<typeof hostDiskSchema>;

/**
 * One reading. Every figure is nullable, and that is the point: a kernel that does not expose a value,
 * a container that hides one, a first sample with no previous to difference against — all of them are
 * "not measured", which a page renders as such rather than as zero (§2.4).
 */
export const hostSampleSchema = z.object({
  at: epochSchema,
  /** Across all cores, 0–100. `null` on the agent's first run: a rate needs two readings. */
  cpuPercent: nullableNumberSchema,
  memoryUsedBytes: nullableNumberSchema,
  memoryTotalBytes: nullableNumberSchema,
  /** The three load averages the kernel publishes. */
  load1: nullableNumberSchema,
  load5: nullableNumberSchema,
  load15: nullableNumberSchema,
  uptimeSeconds: nullableNumberSchema,
  disks: z.array(hostDiskSchema).default([]),
});
export type HostSample = z.infer<typeof hostSampleSchema>;

/**
 * The services an agent can recognise on a host.
 *
 * A deliberately short list of things an operator would want to know are running, not an inventory of
 * every process. `other` exists so a listening port OpsWatch does not recognise is still reported as
 * something listening rather than silently dropped.
 */
export const HOST_SERVICE_KINDS = ['redis', 'postgres', 'mysql', 'nginx', 'apache', 'docker', 'other'] as const;
export type HostServiceKind = (typeof HOST_SERVICE_KINDS)[number];
export const hostServiceKindSchema = lenientEnum(HOST_SERVICE_KINDS, 'other');

/**
 * One service the agent found.
 *
 * **`evidence` is not decoration.** Discovery is a guess made from a listening port and the name of the
 * process holding it, and an operator looking at "Redis" on a page is entitled to know how OpsWatch
 * decided that. It is one short sentence the agent writes — never a paraphrase the server invents.
 */
export const hostServiceSchema = z.object({
  kind: hostServiceKindSchema,
  /** What it calls itself: the process name, or the port where there is nothing better. */
  name: z.string().max(120),
  port: z.number().int().nullable(),
  /** As the service reported it, where it could be asked without credentials. */
  version: z.string().max(80).nullable(),
  /** How the agent concluded this. Shown to the operator verbatim. */
  evidence: z.string().max(200),
});
export type HostService = z.infer<typeof hostServiceSchema>;

/**
 * What Redis says about itself, from `INFO`.
 *
 * An allow-list, and that is the whole point: `INFO` is safe to run and returns no key and no value,
 * but forwarding all of it would send an operator's replication topology and client addresses to a
 * database for no reason. These are the fields somebody diagnosing Redis actually reads.
 *
 * Every one is nullable. A field this build of Redis does not publish is not zero.
 */
export const redisFactsSchema = z.object({
  version: z.string().max(40).nullable(),
  uptimeSeconds: nullableNumberSchema,
  connectedClients: nullableNumberSchema,
  usedMemoryBytes: nullableNumberSchema,
  /** What Redis was told it may use. `null` means no limit is set, which is a real and common answer. */
  maxMemoryBytes: nullableNumberSchema,
  evictedKeys: nullableNumberSchema,
  keyspaceHits: nullableNumberSchema,
  keyspaceMisses: nullableNumberSchema,
  /** Keys across every database, which is a count and never a key. */
  keys: nullableNumberSchema,
  opsPerSecond: nullableNumberSchema,
  role: z.string().max(20).nullable(),
  connectedReplicas: nullableNumberSchema,
  /** Whether the last background save succeeded, as Redis reports it. */
  lastSaveOk: z.boolean().nullable(),
  aofEnabled: z.boolean().nullable(),
});
export type RedisFacts = z.infer<typeof redisFactsSchema>;

/** What the machine says it is. Reported by the agent, never inferred by the server. */
export const hostIdentitySchema = z.object({
  hostname: z.string().max(253),
  /** `/etc/machine-id`, which survives a rename and does not survive a re-image. */
  machineId: z.string().max(128).optional(),
  os: z.string().max(200).optional(),
  kernel: z.string().max(200).optional(),
  arch: z.string().max(40).optional(),
  cloud: hostCloudSchema.optional(),
  /** The provider's own id for this machine — an EC2 instance id, a Droplet id — where it has one. */
  cloudInstanceId: z.string().max(200).optional(),
  agentVersion: z.string().max(40).optional(),
});
export type HostIdentity = z.infer<typeof hostIdentitySchema>;

/** The body an agent posts. Signed; the host it belongs to comes from the signature, never from here. */
export const hostReportSchema = z.object({
  identity: hostIdentitySchema,
  sample: hostSampleSchema.omit({ at: true }),
  /** Optional, so an older agent that does not look for services is still a valid report. */
  services: z.array(hostServiceSchema).max(50).optional(),
  /** Present only when Redis was found *and* could be asked. Absent is a real answer. */
  redis: redisFactsSchema.optional(),
});
export type HostReport = z.infer<typeof hostReportSchema>;

export const hostSchema = z.object({
  id: idSchema,
  /** What the operator called it. Defaults to the hostname the agent first reported. */
  name: z.string(),
  state: hostStateSchema,
  hostname: z.string().nullable(),
  os: z.string().nullable(),
  kernel: z.string().nullable(),
  arch: z.string().nullable(),
  cloud: hostCloudSchema,
  cloudInstanceId: z.string().nullable(),
  /** The AWS region the machine was found in, once an account's instance list has matched it. */
  region: z.string().nullable().default(null),
  agentVersion: z.string().nullable(),
  /** When the agent first proved it had the secret. `null` while the host is still waiting. */
  enrolledAt: epochSchema.nullable(),
  lastSeenAt: epochSchema.nullable(),
  /** The most recent reading, or `null` when nothing has been reported. */
  latest: hostSampleSchema.nullable(),
  /** What was running when the agent last looked. Empty until an agent that looks has reported. */
  services: z.array(hostServiceSchema).default([]),
  /** Redis's own figures, where one was found and could be asked. */
  redis: redisFactsSchema.nullable().default(null),
});
export type Host = z.infer<typeof hostSchema>;

export const hostListSchema = z.object({ items: z.array(hostSchema) });
export type HostList = z.infer<typeof hostListSchema>;

/**
 * How long after its last report a host stops being something OpsWatch can speak for.
 *
 * Three missed runs at the agent's five-minute interval. One missed run is a slow cron; three is a
 * machine that has stopped talking, and the difference between "fine" and "cannot tell" is the whole
 * reason this constant exists rather than a page assuming the last reading still holds.
 */
export const HOST_STALE_AFTER_MS = 16 * 60_000;

/** How often the agent reports. In the install command, in the contract, and in one place only. */
export const HOST_REPORT_INTERVAL_SECONDS = 300;

/**
 * What OpsWatch answers an agent.
 *
 * `nextReportSeconds` rather than nothing: the interval belongs to the server, so changing it is a
 * server change rather than a fleet of machines to go and edit. An agent that cannot parse the answer
 * keeps its own interval, which is why the field is advice and not an instruction.
 */
export const hostAcceptedSchema = z.object({
  accepted: z.number().int().min(0),
  nextReportSeconds: z.number().int().positive(),
});
export type HostAccepted = z.infer<typeof hostAcceptedSchema>;

/**
 * The agent this instance ships.
 *
 * In the script, in every report, and in the answer — so an operator can be told an agent is behind
 * without OpsWatch having to guess, and so an upgrade is a re-run of one command.
 */
export const HOST_AGENT_VERSION = '1.0.0';
