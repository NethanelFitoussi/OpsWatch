import 'server-only';
import { GetFunctionConfigurationCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { clientConfig } from './client-config';
import { sendWithTimeout } from './timeout';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from '../monitoring/call';
import type { MonitoringResult } from '../monitoring/result';

/**
 * What AWS itself says about the forwarder, rather than what a browser said.
 *
 * A stack id, a function ARN and a version typed into a form are claims about somebody's AWS account, not
 * facts about it. These two calls turn them into facts: the function exists, it is in this account and
 * this region, and it reports its own version from its own environment.
 *
 * Neither call costs anything measurable and neither is on a page's critical path — verification happens
 * when an operator asks for it and when the collection settings are saved.
 */

export type ForwarderFacts = {
  /** What the function itself says it is, which is the only version worth believing. */
  version: string | null;
  runtime: string | null;
  lastModified: string | null;
  /** Where it is configured to deliver. Shown so an operator can see it points at their own instance. */
  endpoint: string | null;
};

export function describeForwarder(target: AwsTarget, functionArn: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<ForwarderFacts>> {
  return describeCall(
    target,
    'lambda:GetFunctionConfiguration',
    { functionArn },
    async () => {
      const client = new LambdaClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(client, new GetFunctionConfigurationCommand({ FunctionName: functionArn }), describeTimeout(deps));
      const variables = out.Environment?.Variables ?? {};
      return {
        version: variables.OPSWATCH_FORWARDER_VERSION ?? null,
        runtime: out.Runtime ?? null,
        lastModified: out.LastModified ?? null,
        // The endpoint, never the secret. `OPSWATCH_SECRET` is in the same map and is not read here or
        // anywhere else: OpsWatch has its own copy and has no reason to fetch AWS's.
        endpoint: variables.OPSWATCH_ENDPOINT ?? null,
      };
    },
    deps,
  );
}

/**
 * How many batches the forwarder gave up on.
 *
 * The one number OpsWatch cannot know from its own counters: a batch that never arrived left no trace
 * here. A dead-letter queue nobody can see is a silence, which is why this is worth one API call.
 */
export function describeDeadLetters(target: AwsTarget, queueUrl: string, deps: MonitoringDeps = {}): Promise<MonitoringResult<number>> {
  return describeCall(
    target,
    'sqs:GetQueueAttributes',
    { queueUrl },
    async () => {
      const client = new SQSClient(clientConfig(target.region, target.credentials));
      const out = await sendWithTimeout(
        client,
        new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['ApproximateNumberOfMessages'] }),
        describeTimeout(deps),
      );
      return Number(out.Attributes?.ApproximateNumberOfMessages ?? 0);
    },
    deps,
  );
}
