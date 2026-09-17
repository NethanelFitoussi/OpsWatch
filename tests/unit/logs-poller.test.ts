import { describe, expect, it, vi } from 'vitest';
import type { ClientQueryResults, LogsApi } from '@/lib/monitoring/shared/logs-api';
import { runLogsQuery } from '@/lib/monitoring/shared/logs-poller';

const results = (status: string): ClientQueryResults => ({
  status,
  fields: ['@message'],
  rows: [{ '@message': 'x' }],
  statistics: { recordsMatched: 1, recordsScanned: 1, bytesScanned: 10 },
});
const input = { logGroups: ['/ecs/web'], query: 'fields @message', startSeconds: 0, endSeconds: 3600 };

function setup(statuses: string[], step = 1000) {
  let t = 0;
  const api: LogsApi = {
    start: vi.fn(async () => ({ ok: true as const, data: { queryId: 'q-1' } })),
    poll: vi.fn(async () => ({ ok: true as const, data: results(statuses.shift() ?? 'Running') })),
    stop: vi.fn(async () => {}),
  };
  const sleep = vi.fn(async (ms: number) => {
    t += step === 1000 ? ms : step;
  });
  return { api, sleep, now: () => t, controller: new AbortController(), onProgress: vi.fn() };
}

describe('runLogsQuery', () => {
  it('polls every second until Complete and reports progress', async () => {
    const s = setup(['Scheduled', 'Running', 'Complete']);
    const outcome = await runLogsQuery({ ...s, input, signal: s.controller.signal });
    expect(outcome).toEqual({ kind: 'complete', results: results('Complete') });
    expect(s.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000]);
    expect(s.onProgress).toHaveBeenCalledTimes(3);
    expect(s.api.stop).not.toHaveBeenCalled();
  });

  it.each(['Failed', 'Cancelled', 'Timeout', 'Unknown'])('ends on %s', async (status) => {
    const s = setup([status]);
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'ended', status, results: results(status) });
  });

  it('stops the query after 60 seconds', async () => {
    const s = setup([], 20_000);
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'timeout' });
    expect(s.api.stop).toHaveBeenCalledWith('q-1');
    expect(s.api.poll).toHaveBeenCalledTimes(3);
  });

  it('stops the query when aborted and ignores a failing stop', async () => {
    const s = setup([]);
    vi.mocked(s.api.stop).mockRejectedValueOnce(new Error('moto has no StopQuery'));
    s.sleep.mockImplementationOnce(async () => s.controller.abort());
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({ kind: 'aborted' });
    expect(s.api.stop).toHaveBeenCalledWith('q-1');
  });

  it('returns start and poll errors without polling further', async () => {
    const s = setup([]);
    vi.mocked(s.api.start).mockResolvedValueOnce({ ok: false, error: { code: 'aws_denied', action: 'logs:StartQuery', awsCode: 'AccessDeniedException' } });
    expect(await runLogsQuery({ ...s, input, signal: s.controller.signal })).toEqual({
      kind: 'error',
      error: { code: 'aws_denied', action: 'logs:StartQuery', awsCode: 'AccessDeniedException' },
    });
    expect(s.api.poll).not.toHaveBeenCalled();

    const p = setup([]);
    vi.mocked(p.api.poll).mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    expect(await runLogsQuery({ ...p, input, signal: p.controller.signal })).toEqual({ kind: 'error', error: { code: 'not_found' } });
  });
});
