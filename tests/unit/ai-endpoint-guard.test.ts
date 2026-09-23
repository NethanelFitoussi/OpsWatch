import { describe, expect, it } from 'vitest';
import { isAcceptableEndpoint } from '@/app/[locale]/(app)/settings/ai/endpoint-guard';

/**
 * Which provider endpoints may be written down at all.
 *
 * The fetch-time SSRF guard still applies. This one refuses a URL before it is stored, so nothing sits in
 * the database looking configured that OpsWatch would never call — the same reasoning as the synthetics
 * URL guard, and it caught the same class of mistake.
 */
describe('a provider endpoint', () => {
  it('THE RULING: must be https, because an API key on a plaintext connection is a key somebody else has', () => {
    expect(isAcceptableEndpoint('https://models.example.com')).toBe(true);
    expect(isAcceptableEndpoint('http://models.example.com')).toBe(false);
    expect(isAcceptableEndpoint('file:///etc/passwd')).toBe(false);
    expect(isAcceptableEndpoint('not a url')).toBe(false);
  });

  it('refuses credentials in the URL, which would put a secret in a stored string', () => {
    expect(isAcceptableEndpoint('https://user:pass@models.example.com')).toBe(false);
  });

  it('refuses a query string or a fragment, which belong to a request rather than to an endpoint', () => {
    expect(isAcceptableEndpoint('https://models.example.com/?key=abc')).toBe(false);
    expect(isAcceptableEndpoint('https://models.example.com/#x')).toBe(false);
  });

  it('accepts a path, because a gateway is usually mounted under one', () => {
    expect(isAcceptableEndpoint('https://gateway.example.com/ai/v1')).toBe(true);
  });
});
