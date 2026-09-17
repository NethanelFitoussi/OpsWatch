import { stringify } from 'yaml';
import {
  ASSUME_ROLE_DURATION_SECONDS,
  IAM_POLICY_VERSION,
  ROLE_NAME_PREFIX,
  TEMPLATE_VERSION,
  readOnlyPolicyDocument,
} from './actions';
import type { TrustSpec } from './identity';

export type TemplateInput = { connectionId: string; externalId: string; trust: TrustSpec };

/** Prefix of every AWS name OpsWatch derives from a connection: stack, template file, role session. */
export const resourcePrefix = (connectionId: string) => `opswatch-${connectionId}`;
export const roleNameFor = (connectionId: string) => `${ROLE_NAME_PREFIX}${connectionId}`;
export const roleArnFor = (accountId: string, connectionId: string, partition = 'aws') =>
  `arn:${partition}:iam::${accountId}:role/${roleNameFor(connectionId)}`;
export const stackNameFor = (connectionId: string) => resourcePrefix(connectionId);
export const templateFileNameFor = (connectionId: string) => `${resourcePrefix(connectionId)}.yaml`;
export const templateObjectKey = (connectionId: string) =>
  `opswatch/templates/${resourcePrefix(connectionId)}-v${TEMPLATE_VERSION}.yaml`;

type TrustCondition = {
  StringEquals: { 'sts:ExternalId': string };
  ArnLike?: { 'aws:PrincipalArn': string[] };
};

export type CloudFormationRoleTemplate = {
  AWSTemplateFormatVersion: string;
  Description: string;
  Resources: {
    OpsWatchReadOnlyRole: {
      Type: 'AWS::IAM::Role';
      Properties: {
        RoleName: string;
        MaxSessionDuration: number;
        AssumeRolePolicyDocument: {
          Version: string;
          Statement: { Effect: 'Allow'; Principal: { AWS: string }; Action: 'sts:AssumeRole'; Condition: TrustCondition }[];
        };
        Policies: { PolicyName: string; PolicyDocument: ReturnType<typeof readOnlyPolicyDocument> }[];
      };
    };
  };
  Outputs: {
    RoleArn: { Description: string; Value: { 'Fn::GetAtt': [string, string] } };
    OpsWatchTemplateVersion: { Value: string };
  };
};

export function buildTemplate(input: TemplateInput): CloudFormationRoleTemplate {
  const condition: TrustCondition = { StringEquals: { 'sts:ExternalId': input.externalId } };
  if (input.trust.principalArnPatterns?.length) {
    condition.ArnLike = { 'aws:PrincipalArn': input.trust.principalArnPatterns };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `OpsWatch read-only access (template v${TEMPLATE_VERSION})`,
    Resources: {
      OpsWatchReadOnlyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: roleNameFor(input.connectionId),
          MaxSessionDuration: ASSUME_ROLE_DURATION_SECONDS,
          AssumeRolePolicyDocument: {
            Version: IAM_POLICY_VERSION,
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
              PolicyDocument: readOnlyPolicyDocument(),
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
