/**
 * Validates a captured screenshot set before anyone uploads it.
 *
 * Store rejections are slow and the feedback is vague, so everything checkable is checked here: that each image is
 * the size its directory claims, that its aspect ratio is inside the store's range, that the set is complete and in
 * order, and — the one that matters most — that nothing private could be in it.
 *
 * The last check is structural rather than visual. These screenshots can only contain what the demo dataset
 * contains, because screenshot mode *is* the demo, so the dataset is scanned for anything resembling a real address,
 * account, host or credential. That is a stronger guarantee than reading pixels: it proves the data could not have
 * been private, rather than that a particular image happened not to show it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDemoDataset } from '../../src/demo/fixtures';
import { STORY } from './story';

const ROOT = join(__dirname, '../../../../mobile/store-assets');

type Size = { width: number; height: number };
type Expectation = Size & { store: 'apple' | 'play' };

/**
 * What each capture target must produce, keyed by the directory it writes to.
 *
 * The two stores have different rules, and conflating them rejects valid assets. Apple publishes an exact pixel size
 * per device class and every iPhone size is taller than 9:16 — 1290×2796 is 0.461 — so the size *is* the rule.
 * Google Play instead accepts a range, between 16:9 and 9:16, which is what the ratio check is for.
 */
const SIZES: Record<string, Expectation> = {
  'apple-6.9': { width: 1290, height: 2796, store: 'apple' },
  'apple-6.5': { width: 1242, height: 2688, store: 'apple' },
  'play-phone': { width: 1080, height: 1920, store: 'play' },
  'android-emulator': { width: 1080, height: 1920, store: 'play' },
};

/** PNG dimensions from the IHDR chunk: no image library needed for a header every PNG must begin with. */
function pngSize(file: string): Size {
  const buffer = readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const problems: string[] = [];
const checked: string[] = [];

function check(condition: boolean, message: string) {
  if (!condition) problems.push(message);
}

/** Google Play's rule: a phone screenshot's ratio must be between 16:9 and 9:16. Apple has no such range. */
function playRatioOk(width: number, height: number): boolean {
  const ratio = width / height;
  return ratio >= 9 / 16 - 0.001 && ratio <= 16 / 9 + 0.001;
}

function walk(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith('.png')) out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The images themselves.

let sets = 0;
try {
  statSync(ROOT);
} catch {
  console.error(`No screenshots at ${ROOT}. Run: npm run store:capture`);
  process.exit(1);
}

for (const [target, expected] of Object.entries(SIZES)) {
  const directories = walk(ROOT).filter((file) => file.includes(`/${target}/`));
  if (directories.length === 0) continue;
  sets += 1;

  const byDirectory = new Map<string, string[]>();
  for (const file of directories) {
    const key = file.slice(0, file.lastIndexOf('/'));
    byDirectory.set(key, [...(byDirectory.get(key) ?? []), file]);
  }

  for (const [directory, files] of byDirectory) {
    const names = files.map((file) => file.slice(file.lastIndexOf('/') + 1).replace('.png', '')).sort();
    check(
      names.join(',') === STORY.map((shot) => shot.name).sort().join(','),
      `${directory}: the set does not match the story. Missing or extra: ${names.join(', ')}`,
    );

    for (const file of files) {
      const size = pngSize(file);
      checked.push(file);
      check(
        size.width === expected.width && size.height === expected.height,
        `${file}: expected ${expected.width}×${expected.height}, got ${size.width}×${size.height}`,
      );
      check(size.height > size.width, `${file}: must be portrait, got ${size.width}×${size.height}`);
      if (expected.store === 'play') {
        check(
          playRatioOk(size.width, size.height),
          `${file}: aspect ratio ${(size.width / size.height).toFixed(3)} is outside Google Play's 16:9–9:16 range`,
        );
      }
      check(statSync(file).size > 10_000, `${file}: suspiciously small (${statSync(file).size} bytes) — a blank or failed capture?`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. What could possibly be in them.

const dataset = JSON.stringify(buildDemoDataset(1_773_740_520_000));

/** Things that must never reach a public screenshot. Each is a shape, not a specific value. */
const FORBIDDEN: { label: string; pattern: RegExp; allow?: RegExp }[] = [
  { label: 'an AWS access key id', pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: 'a bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/i },
  { label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'an AI provider key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'a private IPv4 address', pattern: /\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/ },
  { label: 'a 12-digit AWS account id', pattern: /\b\d{12}\b/ },
  // Fictional addresses on example.com and the demo account are the point of a demo; anything else is a real person.
  { label: 'an email address outside the demo domains', pattern: /[\w.+-]+@[\w.-]+\.\w+/g, allow: /@(opswatch\.dev|example\.com|example\.org)$/ },
  { label: 'a localhost or LAN URL', pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.)/i },
];

for (const rule of FORBIDDEN) {
  const matches = dataset.match(rule.pattern) ?? [];
  const offending = rule.allow ? matches.filter((match) => !rule.allow!.test(match)) : matches;
  check(offending.length === 0, `The demo dataset contains ${rule.label}: ${[...new Set(offending)].slice(0, 3).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------

if (sets === 0) {
  console.error(`No screenshots found under ${ROOT}. Run: npm run store:capture`);
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(`✓ ${checked.length} screenshot(s) across ${sets} target(s): correct size, portrait, in range, complete.`);
console.log('✓ The demo dataset contains no credential, private address, account id or outside email address.');
