import type { TimeRange } from './time-range';

/** Query text is CloudWatch Logs Insights syntax, so it is never translated. */
export const DEFAULT_LOGS_QUERY = 'fields @timestamp, @message | sort @timestamp desc | limit 100';

export const EXAMPLE_QUERIES = {
  default: DEFAULT_LOGS_QUERY,
  errors: 'fields @timestamp, @logStream, @message | filter @message like /(?i)(error|exception|fatal)/ | sort @timestamp desc | limit 100',
  serverErrors: 'fields @timestamp, @logStream, @message | filter @message like / 5\\d\\d / | sort @timestamp desc | limit 100',
  slowRequests: 'fields @timestamp, @message | parse @message /(?<durationMs>\\d+(\\.\\d+)?)\\s?ms/ | filter durationMs > 1000 | sort durationMs desc | limit 100',
} as const satisfies Record<'default' | 'errors' | 'serverErrors' | 'slowRequests', string>;

type ExampleQueryKey = keyof typeof EXAMPLE_QUERIES;
export const EXAMPLE_QUERY_KEYS = Object.keys(EXAMPLE_QUERIES) as ExampleQueryKey[];

/** Logs Insights queries cover at most 24 hours (global constraint), so the page offers a shorter range list. */
export const LOGS_TIME_RANGES = ['1h', '3h', '12h', '24h'] as const satisfies readonly TimeRange[];
export type LogsTimeRange = (typeof LOGS_TIME_RANGES)[number];

export const LOGS_POLL_INTERVAL_MS = 1000;
export const LOGS_CLIENT_TIMEOUT_MS = 60_000;
/** The stop request must settle on its own even if it never gets a response, so the poller never hangs waiting for it. */
export const LOGS_STOP_TIMEOUT_MS = 5000;

/** Statuses a query never leaves: the poller stops on any of them. */
export const TERMINAL_QUERY_STATUSES = ['Complete', 'Failed', 'Cancelled', 'Timeout', 'Unknown'] as const;
