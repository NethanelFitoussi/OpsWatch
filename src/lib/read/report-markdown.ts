import 'server-only';
import type { Report, ReportSection } from '@opswatch/contract';
import { renderMarkdown, type MarkdownDoc, type MarkdownSection } from '../analysis/markdown';

/**
 * §19's Markdown export: the same report, in a form that can be pasted into a ticket or an email.
 *
 * It is a pure function of the report object, so what is exported is what was on screen — an export that
 * re-queried could differ from the page it claims to be a copy of.
 *
 * Everything reaching the document goes through `renderMarkdown`, which escapes it. That matters here more
 * than anywhere else in the product: a report quotes error messages, and an error message is whatever some
 * upstream service put in a log line. A message shaped like `[click](http://…)` must stay text in the
 * reader's ticket system.
 */

/** Renders a key in the caller's locale. The service never builds a sentence itself (§12.2). */
export type ReportLabels = {
  title: (values: Record<string, string | number>) => string;
  section: (id: string) => string;
  figure: (id: string) => string;
  unavailable: (reason: string) => string;
  period: (from: number, to: number) => string;
  /** The column headings of a report table, which are the same for every section. */
  columns: { name: string; value: string; previous: string; change: string };
  /** What a figure with no measurement reads as — never "0". */
  notMeasured: string;
};

/** A signed change, because "+6" and "6" say different things about a count of failures. */
export function formatDelta(delta: number | null, notMeasured: string): string {
  if (delta === null) return notMeasured;
  if (delta === 0) return '0';
  return delta > 0 ? `+${round(delta)}` : `${round(delta)}`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function cell(value: number | null, notMeasured: string): string {
  return value === null ? notMeasured : round(value);
}

function sectionDoc(section: ReportSection, labels: ReportLabels): MarkdownSection {
  const heading = labels.section(section.id);
  if (section.unavailable !== null) {
    // The reason, in words. A reader must not have to tell an empty table from an unmeasured one.
    return { heading, paragraphs: [labels.unavailable(section.unavailable)] };
  }

  const rows = [
    ...section.figures.map((figure) => [
      labels.figure(figure.id),
      cell(figure.value, labels.notMeasured),
      cell(figure.previous, labels.notMeasured),
      formatDelta(figure.delta, labels.notMeasured),
    ]),
    ...section.rows.map((row) => [
      row.label,
      cell(row.value, labels.notMeasured),
      cell(row.previous, labels.notMeasured),
      formatDelta(row.delta, labels.notMeasured),
    ]),
  ];

  return {
    heading,
    table: {
      headers: [labels.columns.name, labels.columns.value, labels.columns.previous, labels.columns.change],
      rows,
    },
  };
}

export function reportDoc(report: Report, labels: ReportLabels): MarkdownDoc {
  return {
    title: labels.title({ section: report.section }),
    // Both windows, said plainly, because every number below is one compared with the other.
    subtitle: `${labels.period(report.period.from, report.period.to)} — ${labels.period(report.previousPeriod.from, report.previousPeriod.to)}`,
    sections: report.sections.map((section) => sectionDoc(section, labels)),
  };
}

export function reportMarkdown(report: Report, labels: ReportLabels): string {
  return renderMarkdown(reportDoc(report, labels));
}
