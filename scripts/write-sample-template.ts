import fs from 'node:fs';
import path from 'node:path';
import { renderTemplateYaml } from '../src/lib/aws/template';

const out = path.join(process.cwd(), 'tmp', 'opswatch-sample.yaml');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  renderTemplateYaml({
    connectionId: 'abc123def456',
    externalId: 'sample-external-id-0123456789abcdef',
    trust: { principal: 'arn:aws:iam::111122223333:root', principalArnPattern: 'arn:aws:iam::111122223333:role/*opswatch' },
  }),
);
console.log(`wrote ${out}`);
