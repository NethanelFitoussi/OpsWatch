import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/db';
import { newProblem } from '../helpers/detect';

/**
 * Ask OpsWatch (§23, AI-4, AI-5).
 *
 * The assistant narrates what the deterministic engine measured. The rulings are about the three ways that
 * could go wrong: a model given a dump instead of structure, a model asked about an environment nobody has
 * read, and an answer presented as a measurement rather than as the guess it is.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW, render: (key: string) => key };

vi.mock('@/lib/env', () => ({ env: () => ({ OPSWATCH_SECRET: SECRET }) }));

const { MAX_QUESTION_LENGTH, SYSTEM_PROMPT, askOpsWatch } = await import('@/lib/ai/ask');
const { MAX_CONTEXT_BYTES, buildEvidence, hasEvidence } = await import('@/lib/ai/evidence');
const { saveAiConnection } = await import('@/lib/ai/connection');
const { insertProblem } = await import('@/lib/store/problems');
const { recordFamilySnapshot } = await import('@/lib/store/health');

const configure = (db: ReturnType<typeof createTestDb>) =>
  saveAiConnection(db, { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-0123456789abcdef' }, NOW);

const seen = (db: ReturnType<typeof createTestDb>) =>
  recordFamilySnapshot(db, { ...env, family: 'ecs', status: 'degraded', total: 10, affected: 2, readAt: NOW, unavailableReason: null, unavailableCode: null });

/** A provider that echoes the prompt back, so a test can read exactly what it was sent. */
function echoing(captured: { system?: string; prompt?: string }) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { system: string; messages: { content: string }[] };
    captured.system = body.system;
    captured.prompt = body.messages[0].content;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Something shipped shortly before the errors began.' }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('the evidence a question is answered from', () => {
  it('THE RULING: it is structure OpsWatch computed, never a dump', () => {
    const db = createTestDb();
    seen(db);
    insertProblem(db, newProblem({ firstSeenAt: NOW - 600_000, lastSeenAt: NOW, lastEvaluatedAt: NOW }));

    const pack = buildEvidence(db, env, context);
    // Families and problems, already computed. No SQL, no log lines, no AWS identifiers.
    expect(pack.text).toContain('Family ecs');
    expect(pack.text).toContain('Open problems:');
    expect(pack.text).not.toMatch(/select |insert |from problems/i);
  });

  it('carries citations, so an answer can be checked rather than believed', () => {
    const db = createTestDb();
    seen(db);
    const problem = insertProblem(db, newProblem({ firstSeenAt: NOW - 600_000, lastSeenAt: NOW, lastEvaluatedAt: NOW }));
    expect(buildEvidence(db, env, context).citations).toContainEqual(expect.objectContaining({ type: 'problem', id: problem.id }));
  });

  it('THE RULING: an environment nobody has read says so, rather than reading as healthy', () => {
    const db = createTestDb();
    const pack = buildEvidence(db, env, context);
    expect(pack.text).toContain('cannot say whether this environment is healthy');
    // And there is nothing to narrate, so nothing is sent.
    expect(hasEvidence(pack)).toBe(false);
  });

  it('is bounded before it is built, not truncated after the fact', () => {
    const db = createTestDb();
    seen(db);
    for (let n = 0; n < 40; n += 1) {
      insertProblem(db, newProblem({ key: `k${n}`.padEnd(32, 'x'), subjectId: `svc-${n}`, firstSeenAt: NOW - 600_000, lastSeenAt: NOW, lastEvaluatedAt: NOW }));
    }
    const pack = buildEvidence(db, env, context);
    expect(pack.text.length).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    // Eight worst problems, not forty: a question is answered from the worst few.
    expect(pack.citations.filter((one) => one.type === 'problem')).toHaveLength(8);
  });
});

describe('what the model is told', () => {
  it('THE RULING: it is forbidden from inventing a figure or claiming a cause', () => {
    expect(SYSTEM_PROMPT).toContain('Never state a number, a service name or a time that is not in the evidence');
    expect(SYSTEM_PROMPT).toContain('Never say one thing caused another');
    expect(SYSTEM_PROMPT).toContain('say exactly that and say what would');
    // And it is reading, not acting.
    expect(SYSTEM_PROMPT).toContain('Never suggest a command');
  });

  it('is sent the question and the evidence, and nothing else', async () => {
    const db = createTestDb();
    configure(db);
    seen(db);
    const captured: { system?: string; prompt?: string } = {};
    await askOpsWatch(db, { ...env, question: 'why is checkout slow?' }, context, { fetch: echoing(captured) });

    expect(captured.system).toBe(SYSTEM_PROMPT);
    expect(captured.prompt).toContain('Question: why is checkout slow?');
    expect(captured.prompt).toContain('Family ecs');
  });
});

describe('asking', () => {
  it('answers with citations and the model that produced it', async () => {
    const db = createTestDb();
    configure(db);
    seen(db);
    const problem = insertProblem(db, newProblem({ firstSeenAt: NOW - 600_000, lastSeenAt: NOW, lastEvaluatedAt: NOW }));

    const result = await askOpsWatch(db, { ...env, question: 'what is wrong?' }, context, { fetch: echoing({}) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answer.model).toBe('claude-sonnet-5');
    expect(result.answer.citations.map((one) => one.id)).toContain(problem.id);
  });

  it('THE RULING: with nothing measured it refuses to ask rather than getting a confident answer', async () => {
    const db = createTestDb();
    configure(db);
    const sent = vi.fn();
    const result = await askOpsWatch(db, { ...env, question: 'is production healthy?' }, context, {
      fetch: sent as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, error: 'no_evidence' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses a question that is a document, and an empty one', async () => {
    const db = createTestDb();
    configure(db);
    seen(db);
    await expect(askOpsWatch(db, { ...env, question: '   ' }, context)).resolves.toEqual({ ok: false, error: 'invalid_question' });
    await expect(
      askOpsWatch(db, { ...env, question: 'x'.repeat(MAX_QUESTION_LENGTH + 1) }, context),
    ).resolves.toEqual({ ok: false, error: 'invalid_question' });
  });

  it('with no provider configured it says so, without pretending it tried', async () => {
    const db = createTestDb();
    seen(db);
    await expect(askOpsWatch(db, { ...env, question: 'what is wrong?' }, context)).resolves.toEqual({
      ok: false,
      error: 'not_configured',
    });
  });
});
