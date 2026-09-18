/**
 * The app's only logger. It redacts anything that looks like a credential before printing, and prints nothing in
 * production builds except warnings and errors. Never pass response bodies, headers or user input you do not need.
 */

const REDACTIONS: [RegExp, string][] = [
  [/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, '$1[redacted]'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/("?(?:password|passwd|secret|token|access_?token|refresh_?token|api_?key|client_?secret|code_?verifier)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1[redacted]'],
  // AWS access key ids and secret-looking 40-char base64 strings.
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted-aws-key]'],
  [/\b[A-Za-z0-9/+]{40}\b/g, '[redacted-secret]'],
  // GitHub tokens.
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, '[redacted-github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-github-token]'],
  // AI provider keys.
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, '[redacted-api-key]'],
  // Expo push tokens identify a device.
  [/ExponentPushToken\[[^\]]+\]/g, 'ExponentPushToken[redacted]'],
];

export function redact(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}`;
  } else if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text ?? '');
}

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const log = {
  debug(message: string, detail?: unknown) {
    if (isDev) console.warn(`[opswatch] ${redact(message)}${detail === undefined ? '' : ` ${redact(detail)}`}`);
  },
  warn(message: string, detail?: unknown) {
    console.warn(`[opswatch] ${redact(message)}${detail === undefined ? '' : ` ${redact(detail)}`}`);
  },
  error(message: string, detail?: unknown) {
    console.error(`[opswatch] ${redact(message)}${detail === undefined ? '' : ` ${redact(detail)}`}`);
  },
};
