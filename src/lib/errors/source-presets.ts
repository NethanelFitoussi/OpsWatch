/**
 * The field maps a log source can be configured with (§3b, §18).
 *
 * No `server-only` here on purpose: the form that offers these choices runs in the browser, while
 * `lib/read/log-sources.ts` reads the database. `module-boundaries.test.ts` enforces that split.
 *
 * What is stored is **where to look in a log line, never what the line said**. A field map is a set of paths;
 * the log content stays in CloudWatch. That is the whole design of §18 and the reason this file holds paths
 * and nothing else.
 */

export const LOG_FORMATS = ['json', 'regex'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** The fields a fingerprint is built from, plus the route a slow-endpoint query groups by. */
export const MAPPABLE_FIELDS = ['level', 'type', 'message', 'stack', 'route'] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export type FieldMapValues = Partial<Record<MappableField, string>>;

export type SourcePreset = {
  id: string;
  format: LogFormat;
  fields: FieldMapValues;
};

/**
 * Two presets, as §3b asks for: ordinary JSON logs, and the shape this owner's own APIs emit. A preset is a
 * starting point an operator can correct, never a guess applied silently.
 */
export const SOURCE_PRESETS: readonly SourcePreset[] = [
  {
    id: 'json',
    format: 'json',
    fields: { level: '$.level', type: '$.err.type', message: '$.err.message', stack: '$.err.stack', route: '$.path' },
  },
  {
    id: 'api',
    format: 'json',
    fields: { level: '$.level', type: '$.error.name', message: '$.error.message', stack: '$.error.stack', route: '$.route' },
  },
  {
    // Everything on one line, which is what an unstructured container log looks like.
    id: 'plain',
    format: 'regex',
    fields: { message: '(?<message>.*)' },
  },
];

export function presetById(id: string): SourcePreset | null {
  return SOURCE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Which preset a stored map matches, so the form can show what was chosen rather than always "custom". */
export function presetOf(format: string, fields: FieldMapValues): string {
  const match = SOURCE_PRESETS.find(
    (preset) =>
      preset.format === format &&
      MAPPABLE_FIELDS.every((field) => (preset.fields[field] ?? '') === (fields[field] ?? '')),
  );
  return match?.id ?? 'custom';
}

/** A field map is only useful if it can find a message; everything else may legitimately be absent. */
export function isUsableMap(fields: FieldMapValues): boolean {
  return (fields.message ?? '').trim() !== '';
}
