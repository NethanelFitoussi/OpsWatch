import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/lib/clipboard';

/** A minimal DOM for the execCommand fallback: a body and a textarea that can be selected and removed. */
function fakeDocument(execCommand: () => boolean) {
  const textarea = { value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
  return {
    textarea,
    document: { createElement: vi.fn(() => textarea), body: { appendChild: vi.fn() }, execCommand: vi.fn(execCommand) },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyText', () => {
  it('uses the async clipboard API when it is available', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('value')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('value');
  });

  it('falls back to a selected textarea outside a secure context', async () => {
    vi.stubGlobal('navigator', {});
    const { document, textarea } = fakeDocument(() => true);
    vi.stubGlobal('document', document);
    expect(await copyText('value')).toBe(true);
    expect(textarea.value).toBe('value');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalled();
  });

  it('falls back when the clipboard API refuses, and reports failure without throwing', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
    const { document, textarea } = fakeDocument(() => {
      throw new Error('not supported');
    });
    vi.stubGlobal('document', document);
    expect(await copyText('value')).toBe(false);
    expect(textarea.remove).toHaveBeenCalled();
  });
});
