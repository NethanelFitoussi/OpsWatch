import 'server-only';
import { DescribeInstancesCommand, EC2Client, type Instance } from '@aws-sdk/client-ec2';
import { clientConfig } from '../aws/client-config';
import { sendWithTimeout } from '../aws/timeout';
import { describeCall, describeTimeout, type AwsTarget, type MonitoringDeps } from './call';
import type { MetricQuery } from './metrics';
import type { MonitoringResult } from './result';

/**
 * EC2, read through the permission OpsWatch already asks for: `ec2:DescribeInstances`.
 *
 * Deliberately nothing else. `DescribeInstanceStatus` would be the obvious way to get a health verdict and
 * is **not** in the role's policy — adding it would make every already-deployed stack out of date for one
 * signal that CloudWatch publishes anyway, as `StatusCheckFailed`. This file asks for what the role has.
 */

/** How many instances one page of the explorer will read. Beyond it the page says it is showing a subset. */
export const MAX_INSTANCES = 200;

export type Ec2Instance = {
  id: string;
  /** The `Name` tag where there is one; the id otherwise, so a tile is never blank. */
  name: string;
  type: string;
  /** `running`, `stopped`, `pending`, `stopping`, `shutting-down`. Terminated instances are left out. */
  state: string;
  availabilityZone: string;
  privateIp: string | null;
  launchedAt: number | null;
};

const ec2Client = (target: AwsTarget) => new EC2Client(clientConfig(target.region, target.credentials));

function toInstance(instance: Instance): Ec2Instance | null {
  const id = instance.InstanceId;
  if (id === undefined) return null;
  const name = (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value;
  return {
    id,
    name: name !== undefined && name.trim().length > 0 ? name : id,
    type: instance.InstanceType ?? '',
    state: instance.State?.Name ?? 'unknown',
    availabilityZone: instance.Placement?.AvailabilityZone ?? '',
    privateIp: instance.PrivateIpAddress ?? null,
    launchedAt: instance.LaunchTime === undefined ? null : instance.LaunchTime.getTime(),
  };
}

export async function listInstances(target: AwsTarget, deps: MonitoringDeps = {}): Promise<MonitoringResult<{ instances: Ec2Instance[]; truncated: boolean }>> {
  return describeCall(target, 'ec2:DescribeInstances', {}, async () => {
    const client = ec2Client(target);
    const instances: Ec2Instance[] = [];
    let token: string | undefined;
    do {
      const out = await sendWithTimeout(
        client,
        // A terminated instance is a record of something that no longer exists; drawing a tile for it
        // would put a permanent grey square on the map of a healthy estate.
        new DescribeInstancesCommand({
          Filters: [{ Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped', 'shutting-down'] }],
          NextToken: token,
        }),
        describeTimeout(deps),
      );
      for (const reservation of out.Reservations ?? []) {
        for (const instance of reservation.Instances ?? []) {
          const mapped = toInstance(instance);
          if (mapped !== null) instances.push(mapped);
        }
      }
      token = out.NextToken;
    } while (token !== undefined && instances.length < MAX_INSTANCES);

    instances.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
    return { instances: instances.slice(0, MAX_INSTANCES), truncated: instances.length > MAX_INSTANCES };
  }, deps);
}

/**
 * What OpsWatch reads about one instance from CloudWatch.
 *
 * `StatusCheckFailed` is the health signal AWS itself defines — 0 or 1, and `Maximum` over the window is
 * the honest statistic: an instance that failed its check for one minute in ten failed it.
 */
export function instanceQueries(instanceId: string, idPrefix: string): MetricQuery[] {
  const dimensions = { InstanceId: instanceId };
  return [
    { id: `${idPrefix}cpu`, namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensions, stat: 'Average' },
    { id: `${idPrefix}status`, namespace: 'AWS/EC2', metricName: 'StatusCheckFailed', dimensions, stat: 'Maximum' },
    { id: `${idPrefix}netin`, namespace: 'AWS/EC2', metricName: 'NetworkIn', dimensions, stat: 'Average' },
    { id: `${idPrefix}netout`, namespace: 'AWS/EC2', metricName: 'NetworkOut', dimensions, stat: 'Average' },
  ];
}
