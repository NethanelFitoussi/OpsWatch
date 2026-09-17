import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AWS_ICONS, SERVICE_ICONS, type AwsIconName } from '@/components/aws-icon';
import { SERVICE_GROUPS } from '@/lib/aws/actions';

const dir = path.join(process.cwd(), 'public/aws-icons');
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('AWS icons', () => {
  it('ship exactly the icons the app uses', () => {
    const shipped = fs.readdirSync(dir).filter((file) => file.endsWith('.svg')).sort();
    expect(shipped).toEqual([...new Set(Object.values(AWS_ICONS))].sort());
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toContain('Arch_AWS-Application-Auto-Scaling_48.svg');
  });

  it('keep the official file name, which the package also writes in the SVG title', () => {
    for (const file of Object.values(AWS_ICONS)) {
      const svg = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(svg, file).toMatch(new RegExp(`<title>Icon-[^<]*/${file.replace('.svg', '')}</title>`));
    }
  });

  it('cover every service group of the guide and the checklist', () => {
    for (const group of SERVICE_GROUPS) {
      expect(SERVICE_ICONS[group.id].length, group.id).toBeGreaterThan(0);
    }
  });

  it('only stand for the service they name', () => {
    // The AWS icons each group may show; Performance Insights has no official icon.
    const allowed: Record<keyof typeof SERVICE_ICONS, AwsIconName[]> = {
      ecs: ['ecs'],
      ec2: ['ec2'],
      autoscaling: ['autoscaling'],
      elb: ['elb'],
      rds: ['rds', 'aurora'],
      pi: [],
      cloudwatch: ['cloudwatch'],
      logs: ['logs'],
    };
    for (const [group, icons] of Object.entries(SERVICE_ICONS)) {
      const awsIcons = icons.filter((icon): icon is AwsIconName => typeof icon === 'string');
      expect(awsIcons, group).toEqual(allowed[group as keyof typeof SERVICE_ICONS]);
    }
  });

  it('state their source and terms, and the READMEs carry the attribution', () => {
    const notice = read('public/aws-icons/README.md');
    expect(notice).toContain('https://aws.amazon.com/architecture/icons/');
    expect(notice).toContain('2026-07-31');
    expect(read('README.md')).toContain('OpsWatch is not affiliated with AWS.');
    expect(read('README.fr.md')).toContain("OpsWatch n'est pas affilié à AWS.");
  });
});
