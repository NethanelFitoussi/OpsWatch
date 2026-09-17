import { stringify } from 'yaml';
import { ROLE_NAME_PREFIX, TEMPLATE_VERSION, allActions } from './actions';
import type { TrustSpec } from './identity';

export type TemplateInput = { connectionId: string; externalId: string; trust: TrustSpec };

export const roleNameFor = (connectionId: string) => `${ROLE_NAME_PREFIX}${connectionId}`;
export const stackNameFor = (connectionId: string) => `opswatch-${connectionId}`;
export const templateFileNameFor = (connectionId: string) => `opswatch-${connectionId}.yaml`;
export const templateObjectKey = (connectionId: string) =>
  `opswatch/templates/opswatch-${connectionId}-v${TEMPLATE_VERSION}.yaml`;

export function buildTemplate(input: TemplateInput): Record<string, unknown> {
  const condition: Record<string, unknown> = { StringEquals: { 'sts:ExternalId': input.externalId } };
  if (input.trust.principalArnPattern) {
    condition.ArnLike = { 'aws:PrincipalArn': input.trust.principalArnPattern };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `OpsWatch read-only access (template v${TEMPLATE_VERSION})`,
    Resources: {
      OpsWatchReadOnlyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: roleNameFor(input.connectionId),
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: input.trust.principal },
                Action: 'sts:AssumeRole',
                Condition: condition,
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'OpsWatchReadOnly',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Action: allActions(), Resource: '*' }],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      RoleArn: { Description: 'Paste this ARN into OpsWatch', Value: { 'Fn::GetAtt': ['OpsWatchReadOnlyRole', 'Arn'] } },
      OpsWatchTemplateVersion: { Value: String(TEMPLATE_VERSION) },
    },
  };
}

export function renderTemplateYaml(input: TemplateInput): string {
  return stringify(buildTemplate(input), { lineWidth: 0 });
}

export function deployCommand(connectionId: string, region: string): string {
  return [
    'aws cloudformation deploy',
    `--stack-name ${stackNameFor(connectionId)}`,
    `--template-file ${templateFileNameFor(connectionId)}`,
    '--capabilities CAPABILITY_NAMED_IAM',
    `--region ${region}`,
  ].join(' \\\n  ');
}

export function roleArnCommand(connectionId: string, region: string): string {
  return (
    `aws cloudformation describe-stacks --stack-name ${stackNameFor(connectionId)} --region ${region} ` +
    `--query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text`
  );
}

export function quickCreateUrl(input: { bucket: string; connectionId: string; region: string }): string {
  const templateUrl = `https://${input.bucket}.s3.amazonaws.com/${templateObjectKey(input.connectionId)}`;
  return (
    `https://console.aws.amazon.com/cloudformation/home?region=${input.region}` +
    `#/stacks/quickcreate?templateURL=${encodeURIComponent(templateUrl)}&stackName=${stackNameFor(input.connectionId)}`
  );
}
