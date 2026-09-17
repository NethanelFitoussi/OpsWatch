import 'server-only';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
  StopQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { z } from 'zod';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { isOneOf } from '../type-guards';
import { describeCall, describeTimeout, runCall, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';

/** Logs Insights is billed per GB scanned, so every query OpsWatch sends is bounded. */
export const LOGS_MAX_RANGE_SECONDS = 86_400;
export const LOGS_MAX_ROWS = 1000;
export const LOGS_MAX_GROUPS = 20;
export const LOGS_MAX_QUERY_LENGTH = 10_000;
export const LOG_GROUP_SEARCH_LIMIT = 50;

/** How far past "now" a client clock may be before its end time is rejected. */
const CLOCK_SKEW_SECONDS = 300;
const PTR_FIELD = '@ptr';

export type LogGroup = { name: string; storedBytes: number | null; retentionDays: number | null };

export function searchLogGroups(target: AwsTarget, prefix: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<LogGroup[]>> {
  return describeCall(
    target,
    'logs:DescribeLogGroups',
    { prefix },
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(
        client,
        new DescribeLogGroupsCommand({ ...(prefix ? { logGroupNamePrefix: prefix } : {}), limit: LOG_GROUP_SEARCH_LIMIT }),
        describeTimeout(deps),
      );
      return (out.logGroups ?? [])
        .filter((group) => group.logGroupName !== undefined)
        .map((group) => ({ name: group.logGroupName as string, storedBytes: group.storedBytes ?? null, retentionDays: group.retentionInDays ?? null }));
    },
    deps,
  );
}

export type LogsQueryInput = { logGroups: string[]; query: string; startSeconds: number; endSeconds: number };

const inputSchema = z.object({
  logGroups: z.array(z.string().min(1).max(512)).min(1).max(LOGS_MAX_GROUPS),
  query: z.string().trim().min(1).max(LOGS_MAX_QUERY_LENGTH),
  startSeconds: z.number().int(),
  endSeconds: z.number().int(),
});

/** Validates a query request from the browser. The query text is never logged. */
export function parseLogsQueryInput(body: unknown, nowMs: number): { ok: true; value: LogsQueryInput } | { ok: false; error: 'invalid_query' | 'range_too_long' } {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: 'invalid_query' as const };
  const { startSeconds, endSeconds } = parsed.data;
  if (endSeconds <= startSeconds || endSeconds > Math.floor(nowMs / 1000) + CLOCK_SKEW_SECONDS) return { ok: false as const, error: 'invalid_query' as const };
  if (endSeconds - startSeconds > LOGS_MAX_RANGE_SECONDS) return { ok: false as const, error: 'range_too_long' as const };
  return { ok: true as const, value: parsed.data };
}

export function startLogsQuery(target: AwsTarget, input: LogsQueryInput, deps: MonitoringDeps = {}): Promise<MonitoringResult<{ queryId: string }>> {
  // Never cached, and never logged with its query text.
  return runCall(
    target,
    'logs:StartQuery',
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(
        client,
        new StartQueryCommand({
          logGroupNames: input.logGroups,
          queryString: input.query,
          startTime: input.startSeconds,
          endTime: input.endSeconds,
          limit: LOGS_MAX_ROWS,
        }),
        describeTimeout(deps),
      );
      if (!out.queryId) throw Object.assign(new Error('StartQuery returned no query id'), { name: 'MissingQueryId' });
      return { queryId: out.queryId };
    },
    deps,
  );
}

const QUERY_STATUSES = ['Scheduled', 'Running', 'Complete', 'Failed', 'Cancelled', 'Timeout', 'Unknown'] as const;
type QueryStatus = (typeof QUERY_STATUSES)[number];
export type LogsQueryResults = {
  status: QueryStatus;
  fields: string[];
  rows: Record<string, string>[];
  statistics: { recordsMatched: number; recordsScanned: number; bytesScanned: number };
};

export function getLogsQueryResults(target: AwsTarget, queryId: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<LogsQueryResults>> {
  // Never cached: a running query changes on every poll, and results are never kept in the shared cache.
  return runCall(
    target,
    'logs:GetQueryResults',
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(client, new GetQueryResultsCommand({ queryId }), describeTimeout(deps));
      const fields: string[] = [];
      const rows = (out.results ?? []).slice(0, LOGS_MAX_ROWS).map((result) => {
        const row: Record<string, string> = {};
        for (const { field, value } of result) {
          if (field === undefined || value === undefined || field === PTR_FIELD) continue;
          if (!fields.includes(field)) fields.push(field);
          row[field] = value;
        }
        return row;
      });
      return {
        status: isOneOf(QUERY_STATUSES, out.status) ? out.status : 'Unknown',
        fields,
        rows,
        statistics: {
          recordsMatched: out.statistics?.recordsMatched ?? 0,
          recordsScanned: out.statistics?.recordsScanned ?? 0,
          bytesScanned: out.statistics?.bytesScanned ?? 0,
        },
      };
    },
    deps,
  );
}

export function stopLogsQuery(target: AwsTarget, queryId: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<boolean>> {
  return runCall(
    target,
    'logs:StopQuery',
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(client, new StopQueryCommand({ queryId }), describeTimeout(deps));
      return out.success ?? false;
    },
    deps,
  );
}
