import 'server-only';

export type MarkdownTable = { headers: string[]; rows: string[][] };
export type MarkdownSection = { heading: string; paragraphs?: string[]; bullets?: string[]; table?: MarkdownTable };
export type MarkdownDoc = { title: string; subtitle?: string; sections: MarkdownSection[] };

/** The longest single value written into a document: one 60 kB AWS error must not swamp the report. */
export const MARKDOWN_VALUE_MAX = 500;

/**
 * Every text that reaches the document goes through this — title, subtitle, headings, paragraphs, bullets and
 * cells all carry AWS resource names and AWS error messages. The document is pasted into ticket systems that
 * render Markdown with raw HTML, so a message shaped like `<img onerror=…>` must stay text: the ampersand and
 * the angle brackets become entities and the backtick becomes one too (it would otherwise open a code span).
 * The backslash and the pipe are escaped, and newlines are flattened so no value can break out of its block or
 * out of its table cell.
 */
export function escapeMarkdownText(value: string): string {
  const capped = value.length > MARKDOWN_VALUE_MAX ? `${value.slice(0, MARKDOWN_VALUE_MAX)}…` : value;
  return capped
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '&#96;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function renderTable(table: MarkdownTable): string[] {
  const width = table.headers.length;
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => escapeMarkdownText(cells[i] ?? '')).join(' | ')} |`;
  return [row(table.headers), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...table.rows.map(row)];
}

/** Blocks are joined by a blank line; the document ends with exactly one newline. */
export function renderMarkdown(doc: MarkdownDoc): string {
  const blocks: string[] = [`# ${escapeMarkdownText(doc.title)}`];
  if (doc.subtitle) blocks.push(escapeMarkdownText(doc.subtitle));
  for (const section of doc.sections) {
    blocks.push(`## ${escapeMarkdownText(section.heading)}`);
    for (const paragraph of section.paragraphs ?? []) blocks.push(escapeMarkdownText(paragraph));
    if (section.bullets && section.bullets.length > 0) blocks.push(section.bullets.map((b) => `- ${escapeMarkdownText(b)}`).join('\n'));
    if (section.table) blocks.push(renderTable(section.table).join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

const SAFE_REGION = /^[a-z0-9-]{1,32}$/;

/** The filename reaches a Content-Disposition header, so anything but a plain region token is dropped. */
export function markdownFilename(prefix: string, region: string, endMs: number): string {
  const day = new Date(endMs).toISOString().slice(0, 10);
  return SAFE_REGION.test(region) ? `${prefix}-${region}-${day}.md` : `${prefix}-${day}.md`;
}
