import 'server-only';

export type MarkdownTable = { headers: string[]; rows: string[][] };
export type MarkdownSection = { heading: string; paragraphs?: string[]; bullets?: string[]; table?: MarkdownTable };
export type MarkdownDoc = { title: string; subtitle?: string; sections: MarkdownSection[] };

/** Cells are localized text and AWS identifiers: only the pipe, the backslash and newlines can break a table. */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function renderTable(table: MarkdownTable): string[] {
  const width = table.headers.length;
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => escapeMarkdownCell(cells[i] ?? '')).join(' | ')} |`;
  return [row(table.headers), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...table.rows.map(row)];
}

/** Blocks are joined by a blank line; the document ends with exactly one newline. */
export function renderMarkdown(doc: MarkdownDoc): string {
  const blocks: string[] = [`# ${doc.title}`];
  if (doc.subtitle) blocks.push(doc.subtitle);
  for (const section of doc.sections) {
    blocks.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs ?? []) blocks.push(paragraph);
    if (section.bullets && section.bullets.length > 0) blocks.push(section.bullets.map((b) => `- ${b}`).join('\n'));
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
