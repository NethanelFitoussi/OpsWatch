import { describe, expect, it } from 'vitest';
import type { Report } from '@opswatch/contract';
import { formatDelta, reportDoc, reportMarkdown, type ReportLabels } from '@/lib/read/report-markdown';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

const labels: ReportLabels = {
  title: (values) => `Report: ${values.section}`,
  section: (id) => `Section ${id}`,
  figure: (id) => `Figure ${id}`,
  unavailable: (reason) => `Unavailable: ${reason}`,
  period: (from, to) => `${from}..${to}`,
  columns: { name: 'Name', value: 'This period', previous: 'Previous', change: 'Change' },
  notMeasured: 'Not measured',
};

const report = (over: Partial<Report> = {}): Report => ({
  generatedAt: NOW,
  section: 'containers',
  period: { id: '7d', from: NOW - 100, to: NOW },
  previousPeriod: { from: NOW - 200, to: NOW - 100 },
  sections: [],
  ...over,
});

describe('a change is signed, because "+6" and "6" say different things about failures', () => {
  it('signs an increase and keeps a decrease negative', () => {
    expect(formatDelta(6, 'n/a')).toBe('+6');
    expect(formatDelta(-17, 'n/a')).toBe('-17');
    expect(formatDelta(0, 'n/a')).toBe('0');
  });

  it('says so when the change is unknown, rather than printing zero', () => {
    expect(formatDelta(null, 'Not measured')).toBe('Not measured');
  });
});

describe('a section that could not be answered', () => {
  it('exports the reason as a sentence, not an empty table', () => {
    const doc = reportDoc(report({ sections: [{ id: 'availability', figures: [], rows: [], unavailable: 'history_off' }] }), labels);
    expect(doc.sections[0]).toEqual({ heading: 'Section availability', paragraphs: ['Unavailable: history_off'] });
    // No table at all: an empty one would read as "we looked and found nothing".
    expect(doc.sections[0]?.table).toBeUndefined();
  });
});

describe('a section that was answered', () => {
  const answered = report({
    sections: [
      {
        id: 'problems',
        figures: [{ id: 'opened', value: 14, previous: 31, delta: -17 }],
        rows: [{ id: 'prod/api', label: 'api', value: 3, previous: 1, delta: 2 }],
        unavailable: null,
      },
    ],
  });

  it('puts figures and rows in one table, each with its comparison', () => {
    const table = reportDoc(answered, labels).sections[0]?.table;
    expect(table?.headers).toEqual(['Name', 'This period', 'Previous', 'Change']);
    expect(table?.rows).toEqual([
      ['Figure opened', '14', '31', '-17'],
      ['api', '3', '1', '+2'],
    ]);
  });

  it('writes an unmeasured cell as words rather than as a number', () => {
    const withGap = report({
      sections: [{ id: 'problems', figures: [{ id: 'opened', value: null, previous: null, delta: null }], rows: [], unavailable: null }],
    });
    expect(reportDoc(withGap, labels).sections[0]?.table?.rows[0]).toEqual([
      'Figure opened', 'Not measured', 'Not measured', 'Not measured',
    ]);
  });

  it('rounds a share rather than printing fifteen decimal places', () => {
    const share = report({
      sections: [{ id: 'availability', figures: [{ id: 'healthyShare', value: (2 / 3) * 100, previous: 0, delta: null }], rows: [], unavailable: null }],
    });
    expect(reportDoc(share, labels).sections[0]?.table?.rows[0]?.[1]).toBe('66.7');
  });
});

describe('the document names both windows, because every number is one against the other', () => {
  it('carries the period and the period before it', () => {
    const doc = reportDoc(report(), labels);
    expect(doc.subtitle).toBe(`${NOW - 100}..${NOW} — ${NOW - 200}..${NOW - 100}`);
  });
});

describe('what a report quotes is not trusted', () => {
  /**
   * A report lists error messages, and an error message is whatever some upstream service wrote into a log
   * line. The document is pasted into ticket systems that render Markdown, so none of it may become markup.
   */
  it('THE RULING: a message shaped like a link stays text', () => {
    const hostile = report({
      sections: [
        {
          id: 'errors',
          figures: [],
          rows: [{ id: 'e1', label: '[click me](https://evil.example.com) `x` <img onerror=1>', value: 1, previous: 0, delta: 1 }],
          unavailable: null,
        },
      ],
    });
    const markdown = reportMarkdown(hostile, labels);
    expect(markdown).not.toContain('[click me](https://evil.example.com)');
    expect(markdown).not.toContain('<img');
    expect(markdown).toContain('&lt;img');
    // And it cannot break out of its own table cell.
    expect(markdown.split('\n').filter((line) => line.includes('click me'))).toHaveLength(1);
  });

  it('keeps a pipe inside its cell rather than inventing a column', () => {
    const piped = report({
      sections: [{ id: 'errors', figures: [], rows: [{ id: 'e1', label: 'a | b | c', value: 1, previous: 0, delta: 1 }], unavailable: null }],
    });
    const row = reportMarkdown(piped, labels).split('\n').find((line) => line.includes('a \\| b'));
    expect(row).toBeDefined();
    // Four columns, as declared: the escaped pipes did not add any.
    expect(row?.split(/(?<!\\)\|/).filter((part) => part.trim() !== '')).toHaveLength(4);
  });
});
