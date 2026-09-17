import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION, allActions } from '@/lib/aws/actions';
import {
  buildTemplate,
  deployCommand,
  quickCreateUrl,
  renderTemplateYaml,
  roleArnCommand,
  roleNameFor,
  templateObjectKey,
} from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';

const input = {
  connectionId: 'abc123def456',
  externalId: 'ext-1234567890',
  trust: { principal: 'arn:aws:iam::111122223333:user/opswatch' },
};

type Template = {
  Resources: {
    OpsWatchReadOnlyRole: {
      Type: string;
      Properties: {
        RoleName: string;
        MaxSessionDuration: number;
        AssumeRolePolicyDocument: { Statement: Array<Record<string, unknown>> };
        Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[]; Resource: string }> } }>;
      };
    };
  };
  Outputs: Record<string, { Value: unknown }>;
};

describe('CloudFormation template', () => {
  it('creates the read-only role with the exact actions', () => {
    const t = parse(renderTemplateYaml(input)) as Template;
    const role = t.Resources.OpsWatchReadOnlyRole;
    expect(role.Type).toBe('AWS::IAM::Role');
    expect(role.Properties.RoleName).toBe('OpsWatchReadOnly-abc123def456');
    expect(role.Properties.MaxSessionDuration).toBe(3600);
    const statement = role.Properties.Policies[0].PolicyDocument.Statement[0];
    expect(statement.Action).toEqual(allActions());
    expect(statement.Resource).toBe('*');
  });

  it('requires the ExternalId and trusts the given principal', () => {
    const t = buildTemplate(input) as unknown as Template;
    expect(t.Resources.OpsWatchReadOnlyRole.Properties.AssumeRolePolicyDocument.Statement[0]).toEqual({
      Effect: 'Allow',
      Principal: { AWS: 'arn:aws:iam::111122223333:user/opswatch' },
      Action: 'sts:AssumeRole',
      Condition: { StringEquals: { 'sts:ExternalId': 'ext-1234567890' } },
    });
  });

  it('adds a principal ARN condition listing every pattern of the trust spec', () => {
    const patterns = ['arn:aws:iam::111122223333:role/task', 'arn:aws:iam::111122223333:role/*/task'];
    const t = buildTemplate({
      ...input,
      trust: { principal: 'arn:aws:iam::111122223333:root', principalArnPatterns: patterns },
    }) as unknown as Template;
    expect(t.Resources.OpsWatchReadOnlyRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition).toEqual({
      StringEquals: { 'sts:ExternalId': 'ext-1234567890' },
      ArnLike: { 'aws:PrincipalArn': patterns },
    });
  });

  it('outputs the role ARN and the template version', () => {
    const t = buildTemplate(input) as unknown as Template;
    expect(t.Outputs.RoleArn.Value).toEqual({ 'Fn::GetAtt': ['OpsWatchReadOnlyRole', 'Arn'] });
    expect(t.Outputs.OpsWatchTemplateVersion.Value).toBe(String(TEMPLATE_VERSION));
  });

  it('builds the CLI commands and names', () => {
    expect(roleNameFor('abc123def456')).toBe('OpsWatchReadOnly-abc123def456');
    expect(deployCommand('abc123def456', 'eu-west-1')).toBe(
      'aws cloudformation deploy \\\n  --stack-name opswatch-abc123def456 \\\n  --template-file opswatch-abc123def456.yaml \\\n  --capabilities CAPABILITY_NAMED_IAM \\\n  --region eu-west-1',
    );
    expect(roleArnCommand('abc123def456', 'eu-west-1')).toBe(
      "aws cloudformation describe-stacks --stack-name opswatch-abc123def456 --region eu-west-1 --query \"Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue\" --output text",
    );
  });

  it('builds the quick-create URL for a template in a bucket', () => {
    expect(templateObjectKey('abc123def456')).toBe('opswatch/templates/opswatch-abc123def456-v1.yaml');
    const url = new URL(quickCreateUrl({ bucket: 'my-bucket', connectionId: 'abc123def456', region: 'eu-west-1' }));
    expect(url.origin).toBe('https://console.aws.amazon.com');
    expect(url.searchParams.get('region')).toBe('eu-west-1');
    expect(url.hash).toBe(
      '#/stacks/quickcreate?templateURL=' +
        encodeURIComponent('https://my-bucket.s3.amazonaws.com/opswatch/templates/opswatch-abc123def456-v1.yaml') +
        '&stackName=opswatch-abc123def456',
    );
  });

  it('uploads the template to the configured bucket', async () => {
    const s3 = mockClient(S3Client);
    s3.on(PutObjectCommand).resolves({});
    await uploadTemplate({ bucket: 'my-bucket', connectionId: 'abc123def456', region: 'eu-west-1', body: 'yaml' });
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({
      Bucket: 'my-bucket',
      Key: 'opswatch/templates/opswatch-abc123def456-v1.yaml',
      Body: 'yaml',
      ContentType: 'application/x-yaml',
    });
  });
});
