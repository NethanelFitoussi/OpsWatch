import 'server-only';
import type { StackFrame } from './fingerprint';

/**
 * Turning one log line into the four things a fingerprint needs: level, type, message, stack (§18).
 *
 * The **mapping** is configured per log source and stored; the log content is not. Pure, so a field map can
 * be tested against a sample without touching AWS.
 */
export type FieldMap = {
  level?: string;
  type?: string;
  message?: string;
  stack?: string;
  route?: string;
};

export type ParsedLine = {
  level: string | null;
  type: string | null;
  message: string | null;
  stack: string | null;
  route: string | null;
};

const EMPTY: ParsedLine = { level: null, type: null, message: null, stack: null, route: null };

/** `$.a.b` into a nested object. Anything missing is null, never guessed at. */
function pick(source: unknown, path: string | undefined): string | null {
  if (path === undefined) return null;
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let value: unknown = source;
  for (const part of parts) {
    if (value === null || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[part];
  }
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseJsonLine(raw: string, map: FieldMap): ParsedLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON after all. The raw line is still the most useful thing we have, so it becomes the message.
    return { ...EMPTY, message: raw.trim() || null };
  }
  return {
    level: pick(parsed, map.level),
    type: pick(parsed, map.type),
    message: pick(parsed, map.message),
    stack: pick(parsed, map.stack),
    route: pick(parsed, map.route),
  };
}

/** A regex source names its fields with capture groups: `(?<message>...)`. */
function parseRegexLine(raw: string, pattern: string): ParsedLine {
  let match: RegExpMatchArray | null = null;
  try {
    match = raw.match(new RegExp(pattern));
  } catch {
    // A pattern an operator typed wrongly must not take the cycle down.
    return { ...EMPTY, message: raw.trim() || null };
  }
  const groups = match?.groups ?? {};
  return {
    level: groups.level ?? null,
    type: groups.type ?? null,
    message: groups.message ?? (raw.trim() || null),
    stack: groups.stack ?? null,
    route: groups.route ?? null,
  };
}

export function parseLine(raw: string, format: 'json' | 'regex', map: FieldMap): ParsedLine {
  return format === 'json' ? parseJsonLine(raw, map) : parseRegexLine(raw, map.message ?? '(?<message>.*)');
}

/**
 * Stack frames from a textual stack trace, in the common `at fn (file:line:col)` shape that Node, Chrome and
 * most JVM/Python formatters approximate.
 *
 * Line and column are matched and then deliberately thrown away — the fingerprint drops them because they
 * move on a whitespace commit — but they are matched so that a frame carrying them is not mistaken for a
 * filename with colons in it.
 *
 * Numbered groups rather than named ones: this project compiles to ES2017, where a named group in a literal
 * is a syntax error. A pattern an operator supplies at run time may still use them, because that one is built
 * with `new RegExp` and never sees the compiler.
 */
// 1: function (optional) · 2: file
const NODE_FRAME = /^\s*at\s+(?:([^\s(]+)\s+\()?([^\s()]+?)(?::\d+)?(?::\d+)?\)?\s*$/;
// 1: file · 2: function
const PY_FRAME = /^\s*File\s+"([^"]+)",\s+line\s+\d+,\s+in\s+(\S+)/;

export function parseStack(stack: string | null): StackFrame[] {
  if (stack === null) return [];
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const python = raw.match(PY_FRAME);
    if (python) {
      frames.push({ file: python[1], function: python[2] });
      continue;
    }
    const node = raw.match(NODE_FRAME);
    if (!node || node[2] === undefined) continue;
    const frame: StackFrame = { file: node[2] };
    if (node[1] !== undefined) frame.function = node[1];
    frames.push(frame);
  }
  return frames;
}
