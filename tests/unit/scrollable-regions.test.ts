import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A region that scrolls sideways is reachable by keyboard.
 *
 * At 390px almost every table in this product scrolls horizontally. A scroll container that nothing can
 * focus is reachable with a mouse and with a trackpad and with nothing else: the columns past the right
 * edge simply do not exist for somebody using a keyboard or a switch. axe calls it
 * `scrollable-region-focusable`, and it is a WCAG 2.1 A failure.
 *
 * `src/components/ui/table.tsx` handles it for every table built from the shared component. This guard is
 * for the hand-rolled ones: it found four, one of which axe only noticed because a test happened to leave
 * a log source switched on and gave the report a table to draw.
 *
 * A container is accepted when it is focusable itself (`tabIndex={0}`) or when the thing inside it is the
 * shared `<Table>`, which is.
 *
 * axe also exempts a region whose children are focusable, because tabbing through them scrolls it — but
 * that cannot be read from the source, and reading it wrong is how this stayed broken. The report table
 * holds a `<Link>` on rows that *have a problem to link to*, and the section axe caught had no rows at
 * all. So the exemption is a written list of the regions whose focusable children are unconditional,
 * each with the reason, rather than a pattern that guesses.
 */

const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

/** The shared table, which carries its own tabIndex; anything else has to say so itself. */
const SHARED_TABLE = /<Table[\s>]/;

/**
 * Regions whose focusable children are structural and always rendered, which is axe's own exemption.
 * Adding a tab stop to these would put one before every navigation list on every page for no gain.
 */
const ALWAYS_FOCUSABLE_CHILDREN = new Map<string, string>([
  ['components/monitoring/section-panel.tsx', 'a sub-section nav: the strip is the links, and tabbing through them scrolls it'],
]);

function scrollers(text: string): { line: number; opening: string; inside: string }[] {
  const lines = text.split('\n');
  const found: { line: number; opening: string; inside: string }[] = [];
  lines.forEach((line, index) => {
    if (!line.includes('overflow-x-auto')) return;
    // The class may sit on a line of its own inside a multi-line element, so walk back to the `<`.
    let opening = line;
    for (let back = index; back >= 0 && !opening.includes('<'); back -= 1) opening = `${lines[back]}\n${opening}`;
    // Everything nested under it, by indentation: the codebase is formatted, and a fixed window of
    // lines missed a <Link> that sat twenty-odd lines down inside a `.map`.
    const indent = line.search(/\S/);
    const body: string[] = [];
    for (const below of lines.slice(index + 1)) {
      if (below.trim() !== '' && below.search(/\S/) <= indent) break;
      body.push(below);
    }
    found.push({ line: index + 1, opening, inside: body.join('\n') });
  });
  return found;
}

describe('every horizontally scrollable region can be reached without a mouse', () => {
  const offenders = files(SRC).flatMap((file) => {
    const name = file.slice(SRC.length + 1);
    if (ALWAYS_FOCUSABLE_CHILDREN.has(name)) return [];
    return scrollers(readFileSync(file, 'utf8'))
      .filter(({ opening, inside }) => !opening.includes('tabIndex={0}') && !SHARED_TABLE.test(inside.split('\n')[0] ?? ''))
      .map(({ line }) => `${name}:${line}`);
  });

  it('THE RULING: nothing scrolls sideways that a keyboard cannot focus', () => {
    expect(offenders).toEqual([]);
  });

  it('reads enough of the source to be worth trusting', () => {
    const all = files(SRC).flatMap((file) => scrollers(readFileSync(file, 'utf8')));
    expect(all.length).toBeGreaterThan(5);
  });
});
