import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION, allActions } from '@/lib/aws/actions';
import {
  buildTemplate,
  type CloudFormationRoleTemplate,
  deployCommand,
  partitionOf,
  quickCreateUrl,
  renderTemplateYaml,
  roleArnCommand,
  roleArnFor,
  roleNameFor,
  stackNameFor,
  templateFileNameFor,
  templateObjectKey,
} from '@/lib/aws/template';

const input = {
  connectionId: 'abc123def456',
  externalId: 'ext-1234567890',
  trust: { principal: 'arn:aws:iam::111122223333:user/opswatch' },
};

describe('CloudFormation template', () => {
  it('creates the read-only role with the exact actions', () => {
    const t = parse(renderTemplateYaml(input)) as CloudFormationRoleTemplate;
    const role = t.Resources.OpsWatchReadOnlyRole;
    expect(role.Type).toBe('AWS::IAM::Role');
    expect(role.Properties.RoleName).toBe('OpsWatchReadOnly-abc123def456');
    expect(role.Properties.MaxSessionDuration).toBe(3600);
    const statement = role.Properties.Policies[0].PolicyDocument.Statement[0];
    expect(statement.Action).toEqual(allActions());
    expect(statement.Resource).toBe('*');
  });

  it('requires the ExternalId and trusts the given principal', () => {
    const t = buildTemplate(input);
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
    });
    expect(t.Resources.OpsWatchReadOnlyRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition).toEqual({
      StringEquals: { 'sts:ExternalId': 'ext-1234567890' },
      ArnLike: { 'aws:PrincipalArn': patterns },
    });
  });

  it('outputs the role ARN and the template version', () => {
    const t = buildTemplate(input);
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

  it('builds the quick-create URL in the format AWS documents', () => {
    /*
     * Checked against the documented format rather than whatever happened to work:
     * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html
     *
     * A regional console host, `#/stacks/create/review`, a URL-encoded `templateURL`, and a regional S3
     * URL — the documentation lists the three S3 forms the console accepts and every one names a region.
     */
    expect(templateObjectKey('abc123def456')).toBe('opswatch/templates/opswatch-abc123def456-v1.yaml');
    const url = new URL(quickCreateUrl({ bucket: 'my-bucket', connectionId: 'abc123def456', region: 'eu-west-1' }));
    expect(url.origin).toBe('https://eu-west-1.console.aws.amazon.com');
    expect(url.searchParams.get('region')).toBe('eu-west-1');
    expect(url.hash).toBe(
      '#/stacks/create/review?templateURL=' +
        encodeURIComponent('https://my-bucket.s3.eu-west-1.amazonaws.com/opswatch/templates/opswatch-abc123def456-v1.yaml') +
        '&stackName=opswatch-abc123def456',
    );
  });

  it('THE RULING: the ARN the stack will create is one OpsWatch already knows', () => {
    /*
     * Account, role name and partition are all determined before the stack exists, so asking an operator
     * to run a CLI query and paste the answer back was asking them to fetch a string this function can
     * produce. The field is pre-filled from it; the operator presses Save and runs the test.
     */
    expect(roleArnFor('111122223333', 'abc123def456', partitionOf('eu-west-1'))).toBe(
      'arn:aws:iam::111122223333:role/OpsWatchReadOnly-abc123def456',
    );
    // The three partitions AWS has, named by their regions' prefixes.
    expect(partitionOf('cn-north-1')).toBe('aws-cn');
    expect(partitionOf('us-gov-west-1')).toBe('aws-us-gov');
    // Anything else is the ordinary commercial partition, which is every other region there is.
    expect(partitionOf('eu-west-3')).toBe('aws');
    expect(partitionOf('ap-southeast-4')).toBe('aws');
  });

  it('derives every resource name from the connection ID', () => {
    expect(stackNameFor('abc123def456')).toBe('opswatch-abc123def456');
    expect(templateFileNameFor('abc123def456')).toBe('opswatch-abc123def456.yaml');
    expect(roleArnFor('111122223333', 'abc123def456')).toBe('arn:aws:iam::111122223333:role/OpsWatchReadOnly-abc123def456');
    expect(roleArnFor('111122223333', 'abc123def456', 'aws-cn')).toBe('arn:aws-cn:iam::111122223333:role/OpsWatchReadOnly-abc123def456');
  });
});
