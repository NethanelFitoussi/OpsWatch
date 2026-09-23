import 'server-only';
import { sha256Hex } from '../crypto';

/**
 * How OpsWatch decides two exceptions are the same error (§4.4, as ruled on by **§33.13**).
 *
 * The whole value is that a group survives a deploy. A build hash in a path and a minified function name both
 * change on every release, so a fingerprint that noticed either would start a new group every time anyone
 * shipped — and "this started today" would be true of everything, every day.
 *
 * Pure, and deliberately: same input, same fingerprint, on any instance, for ever.
 */
export const FINGERPRINT_VERSION = 1;
export const NORMALIZED_MESSAGE_MAX = 300;
export const MAX_FRAMES = 5;

/** Frames from the runtime or a dependency say nothing about which of *your* errors this is. */
const VENDOR = /node_modules|vendor|site-packages|\/usr\/lib|<internal>/;

/** A path segment that is a content hash: what a bundler puts in a filename and changes on every build. */
const BUILD_HASH = /^[0-9a-f]{8,}$/i;
const HASHED_FILENAME = /^(.*?)[.-][0-9a-f]{8,}(\.[a-z0-9]+)$/i;

/** A minifier's output: one or two characters, or a bare digit run. */
const MINIFIED = /^(?:[A-Za-z_$][A-Za-z0-9_$]?|\d+)$/;

export type StackFrame = {
  file?: string;
  function?: string;
  /** Preferred over both when a source map resolved it (§33.13). */
  symbol?: string;
  /**
   * Where in the file, when the stack said so.
   *
   * **Never part of the fingerprint.** §4.4 groups on the file and the function precisely so that adding a
   * blank line does not split an error group in two — `normalizeFrame` builds `file:function` and these
   * are not in it. They exist so that a *sighting* can point at a line while the *group* stays stable:
   * two questions, two answers, rather than one answer that is wrong for one of them.
   */
  line?: number;
  column?: number;
};

export type FingerprintInput = {
  type?: string;
  message: string;
  frames?: readonly StackFrame[];
  /** Used in place of frames when there is no stack, so two unrelated logs do not merge (§4.4 step 5). */
  logGroup?: string;
};

/**
 * §4.4's normalisation, in the order it gives — and the order is load-bearing. A UUID contains hex runs and
 * digit runs, so replacing digits before UUIDs would destroy it and two different ids would still differ.
 */
export function normalizeMessage(message: string): string {
  let value = message.replace(/\s+/g, ' ');
  value = value.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  value = value.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>');
  value = value.replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, '<ip>');
  value = value.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');
  value = value.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '<email>');
  value = value.replace(/"[^"]*"|'[^']*'/g, '<str>');
  value = value.replace(/\b[0-9a-f]{8,}\b/gi, '<hex>');
  value = value.replace(/\d+/g, '0');
  return value.trim().slice(0, NORMALIZED_MESSAGE_MAX);
}

/**
 * §33.13's frame normalisation. A build hash is stripped from the path, and a minified name is replaced by
 * the frame's **position** rather than kept — two builds minify the same function to different letters, but
 * it is still the third frame in both.
 */
export function normalizeFrame(frame: StackFrame, position: number): string {
  const file = (frame.file ?? '')
    .split('/')
    .map((segment) => {
      if (BUILD_HASH.test(segment)) return '<hash>';
      const hashed = segment.match(HASHED_FILENAME);
      return hashed ? `${hashed[1]}${hashed[2]}` : segment;
    })
    .join('/');

  // A resolved symbol beats both the raw name and the position, because it is the real one.
  const name = frame.symbol ?? frame.function ?? '';
  const fn = frame.symbol !== undefined ? frame.symbol : name === '' || MINIFIED.test(name) ? `<${position}>` : name;
  return `${file}:${fn}`;
}

/** The frames that say which of *your* errors this is: vendor and runtime frames are dropped. */
export function significantFrames(frames: readonly StackFrame[]): string[] {
  return frames
    .filter((frame) => !VENDOR.test(frame.file ?? ''))
    .slice(0, MAX_FRAMES)
    .map((frame, index) => normalizeFrame(frame, index));
}

/**
 * The fingerprint: 32 hex characters over the type, the normalised message and the normalised frames.
 *
 * **Line numbers are deliberately absent.** They move when anyone adds a blank line, and a group that split
 * on a whitespace commit would be worse than no grouping at all.
 */
export function fingerprint(input: FingerprintInput): string {
  const frames = input.frames ? significantFrames(input.frames) : [];
  // With no usable stack, the log group stands in for it, so two unrelated sources do not merge (§4.4 step 5).
  const tail = frames.length > 0 ? frames.join('\n') : (input.logGroup ?? '');
  return sha256Hex(`${input.type ?? ''}\n${normalizeMessage(input.message)}\n${tail}`).slice(0, 32);
}

/**
 * The frames of one sighting, kept as they were read (REPO-5).
 *
 * The counterpart to `significantFrames`: same input, same vendor filtering, same cap — and it keeps the
 * file, the function, the line and the column instead of normalising them away. `significantFrames` feeds
 * the fingerprint and must never carry a line; this feeds a link and is useless without one.
 *
 * Nothing here is an input to `fingerprint`. A test asserts that two sightings differing only by line
 * number produce one group, which is the invariant this whole split exists to protect.
 */
export function sampleFrames(frames: readonly StackFrame[]): { file: string; function: string | null; line: number | null; column: number | null }[] {
  return frames
    .filter((frame) => frame.file !== undefined && !VENDOR.test(frame.file))
    .slice(0, MAX_FRAMES)
    .map((frame) => ({
      file: frame.file as string,
      function: frame.symbol ?? frame.function ?? null,
      line: frame.line ?? null,
      column: frame.column ?? null,
    }));
}
