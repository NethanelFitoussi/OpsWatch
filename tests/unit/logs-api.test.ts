import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogsApi } from '@/lib/monitoring/shared/logs-api';

describe('createLogsApi stop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the DELETE with a timeout signal, so a hung request cannot leave the poller waiting forever', async () => {
    const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await createLogsApi('conn-1', 'eu-west-1').stop('q-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/connections/conn-1/regions/eu-west-1/logs/query/q-1');
    expect(init.method).toBe('DELETE');
    expect(init.keepalive).toBe(true);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a timed-out stop as an ignored failure instead of rejecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'TimeoutError');
      }),
    );

    await expect(createLogsApi('conn-1', 'eu-west-1').stop('q-1')).resolves.toBeUndefined();
  });

  it('ignores any other failed stop request the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(createLogsApi('conn-1', 'eu-west-1').stop('q-1')).resolves.toBeUndefined();
  });
});
