import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { COLLECTION_READ_ACTIONS, COLLECTION_TEMPLATE_VERSION, COLLECTION_WRITE_ACTIONS, collectionPolicyDocument } from '@/lib/aws/collection-actions';
import {
  MAX_INLINE_CODE_BYTES,
  deadLetterQueueUrl,
  buildCollectionTemplate,
  collectionStackNameFor,
  deleteCollectionCommand,
  deployCollectionCommand,
  forwarderSource,
  ownershipTags,
  renderCollectionTemplateYaml,
} from '@/lib/aws/collection-template';
import { allActions, readOnlyPolicyDocument } from '@/lib/aws/actions';

const INPUT = { connectionId: 'abc123def456', endpoint: 'https://opswatch.example.com' };
const template = buildCollectionTemplate(INPUT);
const resources = template.Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>;
const json = JSON.stringify(template);

describe('THE RULING: the base integration stays read-only for ever', () => {
  it('grants no write action in the policy every installation has', () => {
    // This is the policy an operator installs to connect an account. A write action reaching it would
    // reach every OpsWatch installation, including the ones that never enable push.
    const base = JSON.stringify(readOnlyPolicyDocument());
    for (const action of COLLECTION_WRITE_ACTIONS) expect(base, action).not.toContain(action);
    expect(allActions().filter((action) => /:(Put|Delete|Create|Update|Modify|Write|Attach)/.test(action))).toEqual([]);
  });

  it('adds its write permissions by attaching a policy, never by editing the role', () => {
    // The base stack is not touched, so a failed update here cannot take the working integration with it.
    const policy = resources.OpsWatchCollectionPolicy;
    expect(policy.Type).toBe('AWS::IAM::Policy');
    expect(policy.Properties.Roles).toEqual([{ Ref: 'OpsWatchRoleName' }]);
    expect(Object.values(resources).some((resource) => resource.Type === 'AWS::IAM::Role' && resource.Properties.RoleName)).toBe(false);
  });

  it('deleting the stack returns the role to exactly what it was', () => {
    // An `AWS::IAM::Policy` goes with its stack. Nothing in here says otherwise.
    expect(json).not.toContain('DeletionPolicy');
    expect(json).not.toContain('Retain');
  });
});

describe('THE RULING: the template is safe to run in somebody’s production account', () => {
  it('grants no administrator access and no wildcard action', () => {
    const statements = JSON.stringify(collectionPolicyDocument()) + json;
    expect(statements).not.toContain('AdministratorAccess');
    expect(statements).not.toMatch(/"Action"\s*:\s*"\*"/);
    expect(statements).not.toMatch(/"Action"\s*:\s*\[\s*"\*"/);
    expect(statements).not.toMatch(/iam:\*/);
  });

  it('never names a resource with a bare wildcard, except the log groups AWS only accepts that way', () => {
    for (const statement of collectionPolicyDocument().Statement) {
      expect(statement.Resource, statement.Sid).not.toBe('*');
    }
    // And the one that is broad is broad only across log groups of this account.
    const subscriptions = collectionPolicyDocument().Statement.find((one) => one.Sid === 'ManageOpsWatchSubscriptions');
    expect(JSON.stringify(subscriptions?.Resource)).toContain('log-group');
    expect(JSON.stringify(subscriptions?.Resource)).toContain('${AWS::AccountId}');
  });

  it('THE RULING: nothing it creates is reachable by anybody else’s account', () => {
    const invoke = resources.OpsWatchForwarderInvoke;
    // Without `SourceAccount`, any account's log group could invoke this function — a function anybody
    // can make somebody else pay for.
    expect(invoke.Properties.SourceAccount).toEqual({ Ref: 'AWS::AccountId' });
    expect(JSON.stringify(invoke.Properties.Principal)).toContain('logs.');
    // No function URL, and no `*` principal anywhere.
    expect(json).not.toContain('AWS::Lambda::Url');
    expect(json).not.toMatch(/"Principal"\s*:\s*"\*"/);
  });

  it('gives the forwarder its own log group only, not every log group in the account', () => {
    const policy = JSON.stringify(resources.OpsWatchForwarderRole.Properties.Policies);
    // `AWSLambdaBasicExecutionRole` grants every log group in the account, which is more than a
    // forwarder has any use for.
    expect(policy).not.toContain('AWSLambdaBasicExecutionRole');
    expect(policy).toContain('/aws/lambda/${OpsWatchForwarder}');
    expect(policy).not.toContain('logs:CreateLogGroup');
  });

  it('declares the forwarder’s log group, so it does not survive the stack', () => {
    // A log group Lambda creates implicitly is not owned by the stack and outlives it.
    expect(resources.OpsWatchForwarderLogs.Type).toBe('AWS::Logs::LogGroup');
    expect(resources.OpsWatchForwarderLogs.Properties.RetentionInDays).toEqual({ Ref: 'ForwarderLogRetentionDays' });
  });

  it('encrypts the dead-letter queue without asking for a KMS key', () => {
    expect(resources.OpsWatchForwarderDlq.Properties.SqsManagedSseEnabled).toBe(true);
    expect(json).not.toContain('kms:');
  });
});

describe('THE RULING: the secret is never in the template', () => {
  it('is a NoEcho parameter with no default', () => {
    const parameters = template.Parameters as Record<string, Record<string, unknown>>;
    expect(parameters.OpsWatchIngestSecret.NoEcho).toBe(true);
    expect(parameters.OpsWatchIngestSecret.Default).toBeUndefined();
    expect(parameters.OpsWatchIngestSecret.MinLength).toBe(32);
  });

  it('refuses an endpoint that is not HTTPS', () => {
    const parameters = template.Parameters as Record<string, { AllowedPattern?: string }>;
    // The signature protects integrity; it does not make a plaintext request private.
    expect(parameters.OpsWatchEndpoint.AllowedPattern).toBe('^https://.+');
    expect(new RegExp(parameters.OpsWatchEndpoint.AllowedPattern as string).test('http://opswatch.example.com')).toBe(false);
  });

  it('points the forwarder at the ingestion path of the instance it belongs to', () => {
    const variables = JSON.stringify((resources.OpsWatchForwarder.Properties.Environment as { Variables: unknown }).Variables);
    expect(variables).toContain('/api/v1/ingest/aws/logs');
    // The secret arrives by reference, so it is never a literal in the rendered document.
    expect(variables).toContain('"Ref":"OpsWatchIngestSecret"');
  });
});

describe('everything it creates is identifiable', () => {
  it('tags each resource that supports tags', () => {
    expect(ownershipTags('abc', 'Forwarder')).toEqual([
      { Key: 'ManagedBy', Value: 'OpsWatch' },
      { Key: 'OpsWatchIntegrationId', Value: 'abc' },
      { Key: 'OpsWatchComponent', Value: 'Forwarder' },
    ]);
    for (const name of ['OpsWatchForwarder', 'OpsWatchForwarderDlq', 'OpsWatchForwarderRole', 'OpsWatchForwarderLogs']) {
      expect(JSON.stringify(resources[name].Properties.Tags), name).toContain('OpsWatchIntegrationId');
    }
  });

  it('names its own stack and function from the connection, so two never collide', () => {
    expect(collectionStackNameFor('abc123def456')).toBe('opswatch-abc123def456-collection');
    expect(resources.OpsWatchForwarder.Properties.FunctionName).toBe('opswatch-abc123def456-forwarder');
  });
});

describe('the forwarder’s code travels inside the template', () => {
  it('THE RULING: it fits in ZipFile, so there is no bucket and no artifact to host', () => {
    const code = forwarderSource();
    expect(code.length).toBeLessThanOrEqual(MAX_INLINE_CODE_BYTES);
    // An operator can read every line of what they are about to run in their own account.
    expect(code).toContain('x-opswatch-signature');
    expect(code).toContain('export const handler');
  });

  it('carries no prose and no comment, because the explanation belongs in the repository', () => {
    const code = forwarderSource();
    expect(code).not.toContain('/**');
    expect(code.split('\n').some((line) => line.trimStart().startsWith('//'))).toBe(false);
  });

  it('refuses to render rather than produce a template AWS will reject', () => {
    const tooBig = () => buildCollectionTemplate({ ...INPUT, readFile: () => 'x'.repeat(MAX_INLINE_CODE_BYTES + 1) });
    expect(tooBig).toThrow(/over CloudFormation/);
  });
});

describe('THE RULING: the policy grants exactly what is listed and nothing more', () => {
  it('contains every action the catalogue names, and no action it does not', () => {
    const granted = collectionPolicyDocument().Statement.flatMap((statement) => statement.Action);
    // The list in `collection-actions.ts` is the documentation of why each permission exists. A grant
    // that is not on it is a grant nobody wrote a reason for.
    expect([...granted].sort()).toEqual([...COLLECTION_READ_ACTIONS, ...COLLECTION_WRITE_ACTIONS].sort());
  });

  it('grants exactly two actions that change anything', () => {
    expect([...COLLECTION_WRITE_ACTIONS]).toEqual(['logs:PutSubscriptionFilter', 'logs:DeleteSubscriptionFilter']);
  });
});

describe('finding the dead-letter queue', () => {
  it('derives it from what OpsWatch already knows, rather than asking for a second output', () => {
    // The template names it `${AWS::StackName}-dlq`, and the stack name comes from the connection id.
    expect(deadLetterQueueUrl('abc123def456', 'eu-west-1', '123456789012')).toBe(
      'https://sqs.eu-west-1.amazonaws.com/123456789012/opswatch-abc123def456-collection-dlq',
    );
  });

  it('matches the name the template actually gives the queue', () => {
    expect(resources.OpsWatchForwarderDlq.Properties.QueueName).toEqual({ 'Fn::Sub': '${AWS::StackName}-dlq' });
  });
});

describe('the document itself', () => {
  it('is valid YAML with the outputs OpsWatch reads back', () => {
    const parsed = parse(renderCollectionTemplateYaml(INPUT)) as { Outputs: Record<string, unknown> };
    expect(Object.keys(parsed.Outputs).sort()).toEqual([
      'DeadLetterQueueUrl',
      'ForwarderArn',
      'ForwarderVersion',
      'OpsWatchCollectionTemplateVersion',
    ]);
    expect(parsed.Outputs.OpsWatchCollectionTemplateVersion).toEqual({ Value: String(COLLECTION_TEMPLATE_VERSION) });
  });

  it('gives the operator the command to install it and the one to remove it', () => {
    expect(deployCollectionCommand('abc123def456', 'eu-west-1')).toContain('opswatch-abc123def456-collection');
    expect(deployCollectionCommand('abc123def456', 'eu-west-1')).toContain('CAPABILITY_NAMED_IAM');
    // A feature that can only be switched on is not optional.
    expect(deleteCollectionCommand('abc123def456', 'eu-west-1')).toContain('delete-stack');
  });
});
