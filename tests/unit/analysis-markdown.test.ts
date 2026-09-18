import { describe, expect, it } from 'vitest';
import { MARKDOWN_VALUE_MAX, escapeMarkdownText, markdownFilename, renderMarkdown } from '@/lib/analysis/markdown';

/** One AWS error message carrying every character that could break out of its block. */
const HOSTILE = 'boom `tick` <img src=x onerror="alert(1)"> | pipe\nsecond line';
const ESCAPED = 'boom &#96;tick&#96; &lt;img src=x onerror="alert(1)"&gt; \\| pipe second line';

describe('escapeMarkdownText', () => {
  it('keeps a pipe from breaking the table and flattens newlines', () => {
    expect(escapeMarkdownText('a | b')).toBe('a \\| b');
    expect(escapeMarkdownText('line one\nline two')).toBe('line one line two');
    expect(escapeMarkdownText('back\\slash')).toBe('back\\\\slash');
    expect(escapeMarkdownText('  padded  ')).toBe('padded');
    expect(escapeMarkdownText('')).toBe('');
  });
  it('leaves SQL and AWS identifiers readable', () => {
    expect(escapeMarkdownText('SELECT * FROM orders WHERE id = ?')).toBe('SELECT * FROM orders WHERE id = ?');
    expect(escapeMarkdownText('arn:aws:ecs:eu-west-1:1:service/web')).toBe('arn:aws:ecs:eu-west-1:1:service/web');
  });
  it('neutralises backticks and angle brackets so an error shaped like a tag stays text', () => {
    expect(escapeMarkdownText(HOSTILE)).toBe(ESCAPED);
    expect(escapeMarkdownText('a & b')).toBe('a &amp; b');
    expect(escapeMarkdownText('`rm -rf`')).toBe('&#96;rm -rf&#96;');
  });
  it('caps a single value at MARKDOWN_VALUE_MAX characters and marks the cut', () => {
    const long = 'x'.repeat(MARKDOWN_VALUE_MAX);
    expect(escapeMarkdownText(long)).toBe(long);
    expect(escapeMarkdownText(`${long}y`)).toBe(`${long}…`);
    expect(escapeMarkdownText('y'.repeat(MARKDOWN_VALUE_MAX * 3))).toHaveLength(MARKDOWN_VALUE_MAX + 1);
  });
});

describe('renderMarkdown', () => {
  it('renders a title, a subtitle, headings, paragraphs, bullets and a table', () => {
    const out = renderMarkdown({
      title: 'OpsWatch audit',
      subtitle: 'Production · eu-west-1 · last 24 hours',
      sections: [
        { heading: 'Critical', paragraphs: ['2 findings.'], bullets: ['web ran 0 of 2 tasks.', 'api-alb returned 412 5xx errors.'] },
        { heading: 'Coverage', table: { headers: ['Resource', 'Covered'], rows: [['Services', '12 of 12'], ['Instances', '3 of 5']] } },
      ],
    });
    expect(out).toBe(
      '# OpsWatch audit\n' +
      '\n' +
      'Production · eu-west-1 · last 24 hours\n' +
      '\n' +
      '## Critical\n' +
      '\n' +
      '2 findings.\n' +
      '\n' +
      '- web ran 0 of 2 tasks.\n' +
      '- api-alb returned 412 5xx errors.\n' +
      '\n' +
      '## Coverage\n' +
      '\n' +
      '| Resource | Covered |\n' +
      '| --- | --- |\n' +
      '| Services | 12 of 12 |\n' +
      '| Instances | 3 of 5 |\n',
    );
  });

  it('omits an absent subtitle and an empty section body', () => {
    expect(renderMarkdown({ title: 'T', sections: [{ heading: 'Empty' }] })).toBe('# T\n\n## Empty\n');
  });

  it('escapes every cell and pads short rows so the table stays rectangular', () => {
    const out = renderMarkdown({ title: 'T', sections: [{ heading: 'H', table: { headers: ['a|b', 'c'], rows: [['x|y'], ['p', 'q', 'r']] } }] });
    expect(out).toContain('| a\\|b | c |\n');
    expect(out).toContain('| x\\|y |  |\n');
    expect(out).toContain('| p | q |\n');   // extra cells are dropped, never widening the table
  });

  it('escapes the title, the subtitle, the heading, the paragraph, the bullet and the cell alike', () => {
    const out = renderMarkdown({
      title: HOSTILE,
      subtitle: HOSTILE,
      sections: [{ heading: HOSTILE, paragraphs: [HOSTILE], bullets: [HOSTILE], table: { headers: ['h'], rows: [[HOSTILE]] } }],
    });
    expect(out).toBe(
      `# ${ESCAPED}\n\n${ESCAPED}\n\n## ${ESCAPED}\n\n${ESCAPED}\n\n- ${ESCAPED}\n\n| h |\n| --- |\n| ${ESCAPED} |\n`,
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('`');
  });

  it('caps every long value, whoever it reaches the document through', () => {
    const long = 'x'.repeat(MARKDOWN_VALUE_MAX * 2);
    const out = renderMarkdown({ title: long, sections: [{ heading: 'H', paragraphs: [long], table: { headers: ['h'], rows: [[long]] } }] });
    expect(out).not.toContain('x'.repeat(MARKDOWN_VALUE_MAX + 1));
    expect([...out.matchAll(/…/g)]).toHaveLength(3);
  });

  it('ends with exactly one newline', () => {
    const out = renderMarkdown({ title: 'T', sections: [{ heading: 'H', paragraphs: ['p'] }] });
    expect(out.endsWith('p\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('markdownFilename', () => {
  it('names the file from the prefix, the region and the window end', () => {
    expect(markdownFilename('opswatch-audit', 'eu-west-1', Date.parse('2026-09-18T14:00:00Z'))).toBe('opswatch-audit-eu-west-1-2026-09-18.md');
  });
  it('refuses anything that is not a plain region token', () => {
    expect(markdownFilename('opswatch-audit', 'eu west/1"', Date.parse('2026-09-18T14:00:00Z'))).toBe('opswatch-audit-2026-09-18.md');
  });
});
