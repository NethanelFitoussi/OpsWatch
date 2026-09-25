import 'server-only';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  HOST_STALE_AFTER_MS,
  hostServiceSchema,
  redisFactsSchema,
  type Host,
  type HostIdentity,
  type HostSample,
  type HostService,
  type HostState,
  type RedisFacts,
} from '@opswatch/contract';
import { decrypt, encrypt, randomId, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { hostSamples, hosts, type HostRow, type HostSampleRow } from '../db/schema';

/**
 * Linux hosts, their agents' secrets, and what those agents reported (§E).
 *
 * The secret is minted once, encrypted under its own purpose, and never returned to a page again — the
 * only code that reads it back is the one verifying a signature. A page that could re-read it is a page
 * that could leak it, which is the same rule the webhook destinations follow.
 */

/** How many readings a host keeps. Bounded here so one machine cannot fill a self-hoster's disk. */
export const HOST_SAMPLE_LIMIT = 2016;

export type NewHost = { name: string; nowMs: number };

/**
 * Creates a host and returns the secret its agent will sign with, **once**.
 *
 * The caller shows it in the install command and forgets it. A host whose secret was lost is a host to
 * remove and enrol again, which costs a command and is the honest answer: the alternative is a page
 * that can read a credential back.
 */
export function createHost(db: Db, input: NewHost, secret: string): { host: HostRow; agentSecret: string } {
  const agentSecret = randomToken(32);
  const host = db
    .insert(hosts)
    .values({
      id: randomId(),
      name: input.name,
      secretCiphertext: encrypt(agentSecret, secret, 'host-agent'),
      createdAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .returning()
    .get();
  return { host, agentSecret };
}

export function listHostRows(db: Db): HostRow[] {
  return db.select().from(hosts).orderBy(desc(hosts.createdAt)).all();
}

export function findHost(db: Db, id: string): HostRow | null {
  return db.select().from(hosts).where(eq(hosts.id, id)).get() ?? null;
}

/** The secret one host's agent signs with, or null when it cannot be decrypted. */
export function hostSecret(db: Db, id: string, secret: string): string | null {
  const row = findHost(db, id);
  if (row === null) return null;
  try {
    return decrypt(row.secretCiphertext, secret, 'host-agent');
  } catch {
    // A secret sealed under a different `OPSWATCH_SECRET` is unreadable, which is a fact rather than an
    // error: the host has to be enrolled again, and no signature will verify until it is.
    return null;
  }
}

export function deleteHost(db: Db, id: string): number {
  // Samples cascade: a host that is gone must leave no readings nobody can attribute.
  return db.delete(hosts).where(eq(hosts.id, id)).run().changes;
}

export function renameHost(db: Db, id: string, name: string, nowMs: number): number {
  return db.update(hosts).set({ name, updatedAt: nowMs }).where(eq(hosts.id, id)).run().changes;
}

/**
 * Whether another host already claims this machine.
 *
 * `machine_id` is unique where present, so this is what turns a duplicate enrolment into a refusal an
 * operator can read rather than a database error. Two hosts are never merged on a hostname: two
 * machines can share one, and merging them would attribute one's readings to the other.
 */
export function hostClaiming(db: Db, machineId: string): HostRow | null {
  return db.select().from(hosts).where(eq(hosts.machineId, machineId)).get() ?? null;
}

/**
 * Records one report: what the machine says it is, and what it measured.
 *
 * The identity is written every time rather than only at enrolment, because a machine is upgraded, a
 * kernel changes and an agent is updated — and a page showing the kernel from the day it was enrolled
 * would be showing something that is no longer true.
 */
export function recordReport(
  db: Db,
  input: {
    hostId: string;
    identity: HostIdentity;
    sample: Omit<HostSample, 'at'>;
    /** What was running when the agent looked. `undefined` from an agent too old to look. */
    services?: HostService[];
    /** Redis's own figures, where one was found and could be asked. */
    redis?: RedisFacts;
    atMs: number;
  },
): void {
  db.transaction((tx) => {
    const existing = tx.select().from(hosts).where(eq(hosts.id, input.hostId)).get();
    tx.update(hosts)
      .set({
        hostname: input.identity.hostname,
        // A machine id is written once and then left alone: changing it would move the host onto a
        // different machine, which is an enrolment rather than a report.
        machineId: existing?.machineId ?? input.identity.machineId ?? null,
        os: input.identity.os ?? null,
        kernel: input.identity.kernel ?? null,
        arch: input.identity.arch ?? null,
        cloud: input.identity.cloud ?? null,
        cloudInstanceId: input.identity.cloudInstanceId ?? null,
        agentVersion: input.identity.agentVersion ?? null,
        /*
         * Only overwritten when the agent looked.
         *
         * An older agent that does not report services sends nothing, and keeping what the last one
         * found is better than blanking the page — but an agent that looked and found none sends an
         * empty list, and that must clear it. `undefined` and `[]` are different answers.
         */
        services: input.services === undefined ? (existing?.services ?? null) : input.services,
        redis: input.redis === undefined ? (existing?.redis ?? null) : input.redis,
        // The first report is the enrolment: it is the moment the agent proved it holds the secret.
        enrolledAt: existing?.enrolledAt ?? input.atMs,
        lastSeenAt: input.atMs,
        updatedAt: input.atMs,
      })
      .where(eq(hosts.id, input.hostId))
      .run();

    tx.insert(hostSamples)
      .values({
        hostId: input.hostId,
        at: input.atMs,
        cpuPercent: input.sample.cpuPercent,
        memoryUsedBytes: input.sample.memoryUsedBytes,
        memoryTotalBytes: input.sample.memoryTotalBytes,
        load1: input.sample.load1,
        load5: input.sample.load5,
        load15: input.sample.load15,
        uptimeSeconds: input.sample.uptimeSeconds,
        disks: input.sample.disks,
      })
      .run();
  });
}

/** The readings of one host, newest first, bounded. */
export function listSamples(db: Db, hostId: string, limit = 288): HostSampleRow[] {
  return db.select().from(hostSamples).where(eq(hostSamples.hostId, hostId)).orderBy(desc(hostSamples.at)).limit(limit).all();
}

/** Drops readings past what a host keeps, so one machine cannot fill a self-hoster's disk. */
export function pruneSamples(db: Db, hostId: string, keep = HOST_SAMPLE_LIMIT): number {
  const oldest = db
    .select({ at: hostSamples.at })
    .from(hostSamples)
    .where(eq(hostSamples.hostId, hostId))
    .orderBy(desc(hostSamples.at))
    .limit(1)
    .offset(keep - 1)
    .get();
  if (oldest === undefined) return 0;
  return db.delete(hostSamples).where(and(eq(hostSamples.hostId, hostId), lt(hostSamples.at, oldest.at))).run().changes;
}

/**
 * The hosts whose agents report one of these cloud instance ids, keyed by that id.
 *
 * One indexed read rather than one per instance, because the caller is rendering a table.
 */
export function hostsByCloudInstance(db: Db, instanceIds: readonly string[]): Map<string, HostRow> {
  if (instanceIds.length === 0) return new Map();
  const rows = db.select().from(hosts).where(inArray(hosts.cloudInstanceId, [...instanceIds])).all();
  return new Map(rows.flatMap((row) => (row.cloudInstanceId === null ? [] : [[row.cloudInstanceId, row] as const])));
}

/**
 * Records which AWS connection a host's machine was found in.
 *
 * **Matched on the id the provider gave the machine, never on a hostname** — two machines can share a
 * hostname, and merging them would attribute one's readings to the other. The link is written where the
 * evidence already is: the instances page has just listed that account's instances, so the match costs
 * one indexed read and no AWS call of its own. A correlation job would have to fetch every connection's
 * instances to learn the same thing.
 *
 * Only written when it changes, so rendering a page is not a write.
 */
export function linkHostToConnection(db: Db, hostId: string, connectionId: string, nowMs: number): boolean {
  const row = findHost(db, hostId);
  if (row === null || row.connectionId === connectionId) return false;
  db.update(hosts).set({ connectionId, updatedAt: nowMs }).where(eq(hosts.id, hostId)).run();
  return true;
}

/**
 * What OpsWatch can say about a host right now.
 *
 * Three different answers, kept apart on purpose. A host enrolled a minute ago whose agent has not run
 * yet is **waiting**, not unhealthy — calling it unhealthy trains an operator to ignore the colour. A
 * host that reported and then stopped is **stale**, which is "OpsWatch cannot tell you" rather than
 * "this machine is fine", and those must never look the same.
 */
export function hostState(row: Pick<HostRow, 'lastSeenAt'>, nowMs: number): HostState {
  if (row.lastSeenAt === null) return 'waiting';
  return nowMs - row.lastSeenAt <= HOST_STALE_AFTER_MS ? 'healthy' : 'stale';
}

/** How many hosts have reported once and then stopped. What the rail's badge counts. */
export function countStaleHosts(db: Db, nowMs: number): number {
  // A host that has never reported is `waiting`, not stale: it is not a machine that went quiet.
  return db
    .select({ id: hosts.id })
    .from(hosts)
    .where(lt(hosts.lastSeenAt, nowMs - HOST_STALE_AFTER_MS))
    .all().length;
}

/** One host as the contract describes it, with its most recent reading. */
export function toHost(row: HostRow, latest: HostSampleRow | null, nowMs: number): Host {
  return {
    id: row.id,
    name: row.name,
    state: hostState(row, nowMs),
    hostname: row.hostname,
    os: row.os,
    kernel: row.kernel,
    arch: row.arch,
    cloud: (row.cloud as Host['cloud']) ?? 'unknown',
    cloudInstanceId: row.cloudInstanceId,
    agentVersion: row.agentVersion,
    enrolledAt: row.enrolledAt,
    lastSeenAt: row.lastSeenAt,
    latest:
      latest === null
        ? null
        : {
            at: latest.at,
            cpuPercent: latest.cpuPercent,
            memoryUsedBytes: latest.memoryUsedBytes,
            memoryTotalBytes: latest.memoryTotalBytes,
            load1: latest.load1,
            load5: latest.load5,
            load15: latest.load15,
            uptimeSeconds: latest.uptimeSeconds,
            disks: latest.disks,
          },
    // Parsed back rather than trusted: the column is JSON an older build may have written, and a row
    // that no longer matches the schema is dropped rather than rendered.
    services: (row.services ?? []).flatMap((one) => {
      const parsed = hostServiceSchema.safeParse(one);
      return parsed.success ? [parsed.data] : [];
    }),
    redis: row.redis === null ? null : (redisFactsSchema.safeParse(row.redis).data ?? null),
  };
}

/** Every host with its latest reading, for the list. */
export function listHosts(db: Db, nowMs: number): Host[] {
  return listHostRows(db).map((row) => toHost(row, listSamples(db, row.id, 1)[0] ?? null, nowMs));
}

/** Hosts whose agent has reported inside the window, for anything that needs live machines only. */
export function freshHosts(db: Db, nowMs: number): HostRow[] {
  return db.select().from(hosts).where(gte(hosts.lastSeenAt, nowMs - HOST_STALE_AFTER_MS)).all();
}
