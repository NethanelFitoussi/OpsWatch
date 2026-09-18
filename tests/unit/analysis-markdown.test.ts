import { describe, expect, it } from 'vitest';
import { escapeMarkdownCell, markdownFilename, renderMarkdown } from '@/lib/analysis/markdown';

describe('escapeMarkdownCell', () => {
  it('keeps a pipe from breaking the table and flattens newlines', () => {
    expect(escapeMarkdownCell('a | b')).toBe('a \\| b');
    expect(escapeMarkdownCell('line one\nline two')).toBe('line one line two');
    expect(escapeMarkdownCell('back\\slash')).toBe('back\\\\slash');
    expect(escapeMarkdownCell('  padded  ')).toBe('padded');
    expect(escapeMarkdownCell('')).toBe('');
  });
  it('leaves SQL and AWS identifiers readable', () => {
    expect(escapeMarkdownCell('SELECT * FROM orders WHERE id = ?')).toBe('SELECT * FROM orders WHERE id = ?');
    expect(escapeMarkdownCell('arn:aws:ecs:eu-west-1:1:service/web')).toBe('arn:aws:ecs:eu-west-1:1:service/web');
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
