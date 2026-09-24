import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { FORWARDER_VERSION } from '../ingest/forwarder-version';
import { COLLECTION_TEMPLATE_VERSION, collectionPolicyDocument } from './collection-actions';
import { resourcePrefix, roleNameFor } from './template';

/**
 * The **optional** second stack: the one that makes push collection possible.
 *
 * Separate from the base stack, and that is the decision the whole feature turns on. Enabling managed
 * collection must never update the stack that holds the role every existing installation depends on —
 * a failed update there takes the working integration with it. A second stack cannot, an operator who
 * never enables push is never asked to update anything, and switching the feature off is one
 * `delete-stack` after which nothing OpsWatch made remains.
 *
 * Nothing here is retained on delete. No `DeletionPolicy: Retain` anywhere, and the forwarder's own log
 * group is declared rather than left to Lambda to create implicitly — an implicit one survives the stack
 * and is exactly the orphan this is written to avoid.
 *
 * The function's code is **inline**. At about 3.3 kB it fits inside CloudFormation's `ZipFile` limit, so
 * there is no bucket to host an artifact in, no artifact to version, nothing to pull from the internet at
 * deploy time, and an operator can read every line of what they are about to run in their own account.
 */

export const COLLECTION_STACK_SUFFIX = '-collection';
export const collectionStackNameFor = (connectionId: string) => `${resourcePrefix(connectionId)}${COLLECTION_STACK_SUFFIX}`;
export const forwarderNameFor = (connectionId: string) => `${resourcePrefix(connectionId)}-forwarder`;

/** Tags on every resource, so an audit can find what OpsWatch made without guessing from names. */
export function ownershipTags(connectionId: string, component: string): { Key: string; Value: string }[] {
  return [
    { Key: 'ManagedBy', Value: 'OpsWatch' },
    { Key: 'OpsWatchIntegrationId', Value: connectionId },
    { Key: 'OpsWatchComponent', Value: component },
  ];
}

/**
 * The forwarder's source, with the prose removed.
 *
 * The repository keeps it readable; the template carries it compact, because `ZipFile` has 4096 bytes and
 * the explanation of *why* the retry is bounded belongs where somebody maintains it rather than in
 * somebody else's AWS console. The stripping is only block comments and whole-line `//` comments, so it
 * cannot alter a string or an expression.
 */
export function forwarderSource(readFile: (file: string) => string = (file) => fs.readFileSync(file, 'utf8')): string {
  const source = readFile(path.join(process.cwd(), 'forwarder', 'index.mjs'));
  return source
    .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** CloudFormation refuses `ZipFile` longer than this, and there is no second place to put the code. */
export const MAX_INLINE_CODE_BYTES = 4096;

export type CollectionTemplateInput = {
  connectionId: string;
  /** The HTTPS address of the OpsWatch instance the forwarder delivers to. Never a default. */
  endpoint: string;
  readFile?: (file: string) => string;
};

export function buildCollectionTemplate(input: CollectionTemplateInput) {
  const code = forwarderSource(input.readFile);
  if (code.length > MAX_INLINE_CODE_BYTES) {
    // Better to refuse than to render a template AWS will reject after an operator has pasted it in.
    throw new Error(`forwarder source is ${code.length} bytes, over CloudFormation's ${MAX_INLINE_CODE_BYTES}`);
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `OpsWatch managed collection — optional forwarder (collection template v${COLLECTION_TEMPLATE_VERSION}, forwarder v${FORWARDER_VERSION})`,
    Parameters: {
      OpsWatchEndpoint: {
        Type: 'String',
        Default: input.endpoint,
        // HTTPS only. The signature protects integrity; it does not make a plaintext request private.
        AllowedPattern: '^https://.+',
        Description: 'The HTTPS address of your OpsWatch instance. Log records are sent here and nowhere else.',
      },
      OpsWatchIntegrationId: {
        Type: 'String',
        Default: input.connectionId,
        AllowedPattern: '^[a-z0-9]{6,64}$',
        Description: 'Which OpsWatch connection this forwarder belongs to.',
      },
      OpsWatchIngestSecret: {
        Type: 'String',
        NoEcho: true,
        MinLength: 32,
        Description:
          'The signing secret OpsWatch showed you once. It authenticates this forwarder to your OpsWatch; it is not an AWS credential and grants no access to anything in this account.',
      },
      OpsWatchRoleName: {
        Type: 'String',
        Default: roleNameFor(input.connectionId),
        Description: 'The read-only role from your base OpsWatch stack. This stack attaches a policy to it and creates nothing in it.',
      },
      ForwarderLogRetentionDays: {
        Type: 'Number',
        Default: 7,
        AllowedValues: [1, 3, 5, 7, 14, 30, 60, 90],
        Description: "How long the forwarder's own logs are kept. Its logs are about delivery, not about your applications.",
      },
    },
    Resources: {
      /** Declared rather than left to Lambda: an implicit log group survives the stack and is an orphan. */
      OpsWatchForwarderLogs: {
        Type: 'AWS::Logs::LogGroup',
        Properties: {
          LogGroupName: { 'Fn::Sub': '/aws/lambda/${OpsWatchForwarder}' },
          RetentionInDays: { Ref: 'ForwarderLogRetentionDays' },
          Tags: ownershipTags(input.connectionId, 'ForwarderLogs'),
        },
      },
      /** Where a batch goes when the forwarder has exhausted its retries. Reported in OpsWatch. */
      OpsWatchForwarderDlq: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: { 'Fn::Sub': '${AWS::StackName}-dlq' },
          MessageRetentionPeriod: 1209600,
          // Encrypted with the SQS-managed key: no KMS key to create, no KMS permission to grant, and no
          // log line sitting in a queue in the clear.
          SqsManagedSseEnabled: true,
          Tags: ownershipTags(input.connectionId, 'ForwarderDlq'),
        },
      },
      OpsWatchForwarderRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          Policies: [
            {
              PolicyName: 'OpsWatchForwarderExecution',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    // Its own log group only. `AWSLambdaBasicExecutionRole` grants every log group in the
                    // account, which is more than a forwarder has any use for.
                    Sid: 'OwnLogsOnly',
                    Effect: 'Allow',
                    Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: { 'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${OpsWatchForwarder}:*' },
                  },
                  {
                    Sid: 'DeadLetterOnly',
                    Effect: 'Allow',
                    Action: ['sqs:SendMessage'],
                    Resource: { 'Fn::GetAtt': ['OpsWatchForwarderDlq', 'Arn'] },
                  },
                ],
              },
            },
          ],
          Tags: ownershipTags(input.connectionId, 'ForwarderRole'),
        },
      },
      OpsWatchForwarder: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: forwarderNameFor(input.connectionId),
          Description: `Forwards selected CloudWatch log groups to OpsWatch (forwarder v${FORWARDER_VERSION}).`,
          Runtime: 'nodejs22.x',
          Handler: 'index.handler',
          Architectures: ['arm64'],
          // Small and short. It decompresses a batch, signs it and posts it; anything it cannot do in
          // thirty seconds is a delivery problem rather than a bigger-machine problem.
          MemorySize: 256,
          Timeout: 30,
          Role: { 'Fn::GetAtt': ['OpsWatchForwarderRole', 'Arn'] },
          Environment: {
            Variables: {
              OPSWATCH_ENDPOINT: { 'Fn::Sub': '${OpsWatchEndpoint}/api/v1/ingest/aws/logs' },
              OPSWATCH_INTEGRATION: { Ref: 'OpsWatchIntegrationId' },
              OPSWATCH_SECRET: { Ref: 'OpsWatchIngestSecret' },
              OPSWATCH_FORWARDER_VERSION: FORWARDER_VERSION,
            },
          },
          DeadLetterConfig: { TargetArn: { 'Fn::GetAtt': ['OpsWatchForwarderDlq', 'Arn'] } },
          Code: { ZipFile: code },
          Tags: ownershipTags(input.connectionId, 'Forwarder'),
        },
      },
      /**
       * What lets CloudWatch Logs invoke the function, scoped to this account's own log groups.
       *
       * Without `SourceAccount` any account's log group could invoke it, which is a function anybody can
       * make somebody else pay for.
       */
      OpsWatchForwarderInvoke: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: { 'Fn::GetAtt': ['OpsWatchForwarder', 'Arn'] },
          Action: 'lambda:InvokeFunction',
          Principal: { 'Fn::Sub': 'logs.${AWS::Region}.amazonaws.com' },
          SourceAccount: { Ref: 'AWS::AccountId' },
          SourceArn: { 'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:*:*' },
        },
      },
      /**
       * The write permissions, attached to the **existing** role rather than granted by editing it.
       *
       * The base stack is not touched, and deleting this stack takes the policy with it — so switching
       * managed collection off returns the role to exactly the read-only policy it had before.
       */
      OpsWatchCollectionPolicy: {
        Type: 'AWS::IAM::Policy',
        Properties: {
          PolicyName: { 'Fn::Sub': '${AWS::StackName}-manage-subscriptions' },
          Roles: [{ Ref: 'OpsWatchRoleName' }],
          PolicyDocument: collectionPolicyDocument(),
        },
      },
    },
    Outputs: {
      ForwarderArn: { Description: 'Paste this into OpsWatch', Value: { 'Fn::GetAtt': ['OpsWatchForwarder', 'Arn'] } },
      DeadLetterQueueUrl: { Description: 'Where undelivered batches go', Value: { Ref: 'OpsWatchForwarderDlq' } },
      ForwarderVersion: { Value: FORWARDER_VERSION },
      OpsWatchCollectionTemplateVersion: { Value: String(COLLECTION_TEMPLATE_VERSION) },
    },
  };
}

export function renderCollectionTemplateYaml(input: CollectionTemplateInput): string {
  return stringify(buildCollectionTemplate(input), { lineWidth: 0 });
}

/** The command an operator runs. Shown, never executed: OpsWatch does not deploy into anybody's account. */
export function deployCollectionCommand(connectionId: string, region: string): string {
  return [
    'aws cloudformation deploy',
    `--stack-name ${collectionStackNameFor(connectionId)}`,
    `--template-file ${resourcePrefix(connectionId)}-collection.yaml`,
    '--capabilities CAPABILITY_NAMED_IAM',
    `--region ${region}`,
    '--parameter-overrides OpsWatchIngestSecret=<the secret OpsWatch showed you>',
  ].join(' \\\n  ');
}

/** And the command that removes every trace of it. */
export function deleteCollectionCommand(connectionId: string, region: string): string {
  return `aws cloudformation delete-stack --stack-name ${collectionStackNameFor(connectionId)} --region ${region}`;
}
