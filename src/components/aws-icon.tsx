import Image from 'next/image';
import type { ServiceGroupId } from '@/lib/aws/actions';
import { cn } from '@/lib/utils';

/** Official AWS Architecture Icons, unmodified, in public/aws-icons (see its README for the terms). */
export const AWS_ICONS = {
  cloudformation: 'Arch_AWS-CloudFormation_48.svg',
  iam: 'Arch_AWS-Identity-and-Access-Management_48.svg',
  ecs: 'Arch_Amazon-Elastic-Container-Service_48.svg',
  ec2: 'Arch_Amazon-EC2_48.svg',
  elb: 'Arch_Elastic-Load-Balancing_48.svg',
  rds: 'Arch_Amazon-RDS_48.svg',
  aurora: 'Arch_Amazon-Aurora_48.svg',
  cloudwatch: 'Arch_Amazon-CloudWatch_48.svg',
  logs: 'Res_Amazon-CloudWatch_Logs_48.svg',
} as const;

export type AwsIconName = keyof typeof AWS_ICONS;

/** The icons of each permission group; the first one stands for the group where only one fits. */
export const SERVICE_ICONS: Record<ServiceGroupId, readonly AwsIconName[]> = {
  ecs: ['ecs'],
  ec2: ['ec2'],
  autoscaling: ['ec2'],
  elb: ['elb'],
  rds: ['rds', 'aurora'],
  pi: ['rds'],
  cloudwatch: ['cloudwatch'],
  logs: ['logs'],
};

export const awsIconSrc = (name: AwsIconName) => `/aws-icons/${AWS_ICONS[name]}`;

/**
 * One AWS service icon at a fixed size, so it never shifts the layout. `alt` is empty when the service
 * name is written next to it, otherwise the localized service name.
 */
export function AwsIcon({
  name,
  size,
  alt,
  eager,
  className,
}: {
  name: AwsIconName;
  size: number;
  alt: string;
  /** Load at once (navigation), rather than when scrolled into view. */
  eager?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={awsIconSrc(name)}
      width={size}
      height={size}
      alt={alt}
      unoptimized
      loading={eager ? 'eager' : undefined}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}
