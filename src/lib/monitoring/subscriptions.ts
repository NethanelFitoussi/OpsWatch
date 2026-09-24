import 'server-only';
import {
  DeleteSubscriptionFilterCommand,
  DescribeSubscriptionFiltersCommand,
  PutSubscriptionFilterCommand,
  CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { describeCall, describeTimeout, runCall, type AwsTarget, type MonitoringDeps } from './call';
import type { MonitoringResult } from './result';
import type { ExistingFilter } from './shared/subscription-conflict';

/**
 * The three CloudWatch Logs calls that start and stop forwarding.
 *
 * They are the **only** write calls OpsWatch makes into anybody's AWS account, they exist only while an
 * operator has managed collection enabled, and each one is narrow: read what is on a log group, add one
 * filter with OpsWatch's own name, remove one filter with OpsWatch's own name.
 *
 * Nothing here decides anything. `decideSubscription` does, and it is pure.
 */

/** Everything already subscribed to a log group, so OpsWatch can see whose it is before touching it. */
export function describeSubscriptions(target: AwsTarget, logGroup: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<ExistingFilter[]>> {
  return describeCall(
    target,
    'logs:DescribeSubscriptionFilters',
    { logGroup },
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(client, new DescribeSubscriptionFiltersCommand({ logGroupName: logGroup }), describeTimeout(deps));
      return (out.subscriptionFilters ?? []).map((filter) => ({
        filterName: filter.filterName ?? '',
        destinationArn: filter.destinationArn ?? null,
      }));
    },
    deps,
  );
}

/**
 * Starts forwarding one log group.
 *
 * `filterPattern` is empty, which is CloudWatch's "everything in this group". Narrowing it here would be
 * OpsWatch deciding which of somebody's lines matter, and the decision about what is worth reading belongs
 * in OpsWatch where it can be changed without touching their account.
 */
export function putSubscription(
  target: AwsTarget,
  input: { logGroup: string; filterName: string; destinationArn: string },
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<true>> {
  return runCall(
    target,
    'logs:PutSubscriptionFilter',
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      await sendWithTimeout(
        client,
        new PutSubscriptionFilterCommand({
          logGroupName: input.logGroup,
          filterName: input.filterName,
          filterPattern: '',
          destinationArn: input.destinationArn,
        }),
        describeTimeout(deps),
      );
      return true as const;
    },
    deps,
  );
}

/** Stops forwarding one log group. Named, so it can only ever remove a filter OpsWatch put there. */
export function deleteSubscription(
  target: AwsTarget,
  input: { logGroup: string; filterName: string },
  deps: MonitoringDeps = {},
): Promise<MonitoringResult<true>> {
  return runCall(
    target,
    'logs:DeleteSubscriptionFilter',
    async () => {
      const client = new CloudWatchLogsClient(clientConfig(target.region, target.credentials));
      await sendWithTimeout(
        client,
        new DeleteSubscriptionFilterCommand({ logGroupName: input.logGroup, filterName: input.filterName }),
        describeTimeout(deps),
      );
      return true as const;
    },
    deps,
  );
}
