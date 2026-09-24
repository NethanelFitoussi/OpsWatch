import { IAM_POLICY_VERSION } from './actions';

/**
 * The permissions managed collection needs, and not one more.
 *
 * Kept apart from `actions.ts` on purpose: that file is the **read-only** policy every OpsWatch
 * installation has, and it stays read-only for ever. These three write actions exist only while an
 * operator has managed collection enabled, live in a stack they can delete, and are attached to the
 * existing role by a policy rather than by editing the role itself.
 *
 * Why each one:
 *
 * | Action | Why |
 * |---|---|
 * | `logs:DescribeSubscriptionFilters` | To see whose filter is already on a log group **before** writing one. Without it OpsWatch would have to overwrite blind, and that is how another vendor's forwarder disappears. |
 * | `logs:PutSubscriptionFilter` | To start forwarding a log group the operator ticked. |
 * | `logs:DeleteSubscriptionFilter` | To stop. A feature that can only be switched on is not optional. |
 * | `lambda:GetFunctionConfiguration` | To read the forwarder's version from AWS rather than believe what a browser said it is. |
 * | `sqs:GetQueueAttributes` | To report the dead-letter queue's depth. A DLQ nobody can see is a silence. |
 *
 * Every one of them is scoped to a resource except the log-group actions, which AWS only accepts against
 * log-group ARNs — so the narrower guarantee is in the code: OpsWatch reads every filter on a group and
 * writes or deletes **only** one carrying its own name.
 */

export const COLLECTION_TEMPLATE_VERSION = 1;

/** The three that change something. Named, so a reviewer can find every write in one place. */
export const COLLECTION_WRITE_ACTIONS = [
  'logs:PutSubscriptionFilter',
  'logs:DeleteSubscriptionFilter',
] as const;

export const COLLECTION_READ_ACTIONS = [
  'logs:DescribeSubscriptionFilters',
  'lambda:GetFunctionConfiguration',
  'sqs:GetQueueAttributes',
] as const;

/**
 * The policy attached to the existing read-only role while managed collection is on.
 *
 * Three statements rather than one, because three different resources are being named. A single statement
 * with every action against `*` would be shorter and would grant `DeleteSubscriptionFilter` on a resource
 * that has no subscription filters.
 *
 * `cloudformation:DescribeStacks` was considered and dropped: the function existing, with its version in
 * its own environment, is what OpsWatch actually needs to verify, and a stack status adds a permission
 * for something already answered.
 */
export function collectionPolicyDocument() {
  return {
    Version: IAM_POLICY_VERSION,
    Statement: [
      {
        Sid: 'ManageOpsWatchSubscriptions',
        Effect: 'Allow' as const,
        Action: ['logs:DescribeSubscriptionFilters', ...COLLECTION_WRITE_ACTIONS],
        // AWS accepts these only against log-group ARNs. The code is the narrower rule: OpsWatch writes
        // and deletes only a filter carrying its own name, and refuses to touch anybody else's.
        Resource: { 'Fn::Sub': 'arn:${AWS::Partition}:logs:*:${AWS::AccountId}:log-group:*' },
      },
      {
        Sid: 'ReadForwarderVersion',
        Effect: 'Allow' as const,
        Action: ['lambda:GetFunctionConfiguration'],
        Resource: { 'Fn::GetAtt': ['OpsWatchForwarder', 'Arn'] },
      },
      {
        Sid: 'ReadDeadLetterQueue',
        Effect: 'Allow' as const,
        Action: ['sqs:GetQueueAttributes'],
        Resource: { 'Fn::GetAtt': ['OpsWatchForwarderDlq', 'Arn'] },
      },
    ],
  };
}
