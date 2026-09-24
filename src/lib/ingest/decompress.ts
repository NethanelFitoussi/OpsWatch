import 'server-only';
import { gunzipSync } from 'node:zlib';
import { INGEST_LIMITS } from '@opswatch/contract';

/**
 * Reading a compressed body without letting it decide how much memory to use.
 *
 * CloudWatch Logs hands a Lambda gzip, and a forwarder that gzips its own request saves an operator real
 * money on egress — so the endpoint accepts `content-encoding: gzip`. That acceptance is also the classic
 * way to hand an attacker an out-of-memory: a few kilobytes of zeros expand to gigabytes.
 *
 * `maxOutputLength` is node's own bound and it is the whole defence. zlib stops at the limit and throws
 * rather than allocating past it, so the refusal happens inside the decompressor instead of inside the
 * heap. Checking the size *after* decompressing would be checking it after the damage.
 */

export type DecompressResult = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'bad_body' };

export function readBody(bytes: Uint8Array, encoding: string | null): DecompressResult {
  if (bytes.byteLength > INGEST_LIMITS.maxBodyBytes) return { ok: false, reason: 'too_large' };

  if (encoding === null || encoding === '' || encoding === 'identity') {
    return { ok: true, text: Buffer.from(bytes).toString('utf8') };
  }
  if (encoding !== 'gzip') return { ok: false, reason: 'bad_body' };

  try {
    // The bound is given to zlib, not applied to its output: it stops there instead of allocating past it.
    const out = gunzipSync(Buffer.from(bytes), { maxOutputLength: INGEST_LIMITS.maxDecompressedBytes });
    return { ok: true, text: out.toString('utf8') };
  } catch (error) {
    // zlib says `ERR_BUFFER_TOO_LARGE` when it hit the bound. Anything else is a body that is not gzip.
    const code = (error as { code?: string }).code;
    return { ok: false, reason: code === 'ERR_BUFFER_TOO_LARGE' ? 'too_large' : 'bad_body' };
  }
}
