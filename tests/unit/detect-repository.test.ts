import { describe, expect, it } from 'vitest';
import {
  MIN_SUGGESTION_SCORE,
  fileUrl,
  locateFrame,
  normalizeName,
  repositoryFromImage,
  suggestRepository,
  type RepositoryRef,
} from '@/lib/detect/repository';

const repo = (name: string, id = name): RepositoryRef => ({ id, owner: 'acme', name, defaultBranch: 'main' });

describe('normalising a name so two spellings of one thing match', () => {
  it('ignores case, separators and the suffixes everyone adds', () => {
    expect(normalizeName('payment-service')).toBe('payment');
    expect(normalizeName('PaymentAPI')).toBe('payment');
    expect(normalizeName('payment_svc')).toBe('payment');
  });

  it('takes the last segment of a qualified name', () => {
    expect(normalizeName('prod/web')).toBe('web');
  });
});

describe('reading a repository name out of an image reference', () => {
  it('drops the registry, the tag and the digest', () => {
    expect(repositoryFromImage('ghcr.io/acme/web:1.2.3')).toBe('web');
    expect(repositoryFromImage('acme/web@sha256:abc')).toBe('web');
    expect(repositoryFromImage('web')).toBe('web');
  });

  it('answers null for nothing, rather than an empty string that would match everything', () => {
    expect(repositoryFromImage(null)).toBeNull();
    expect(repositoryFromImage('  ')).toBeNull();
  });
});

describe('§13 — OpsWatch suggests and never applies', () => {
  it('prefers the image, which is the strongest evidence available', () => {
    const suggestion = suggestRepository(
      { id: 'prod/web', name: 'web', image: 'ghcr.io/acme/storefront:1' },
      [repo('web'), repo('storefront')],
    );
    expect(suggestion).toMatchObject({ repositoryId: 'storefront', score: 1, because: 'image_matches' });
  });

  it('falls back to an exact name match', () => {
    expect(suggestRepository({ id: 'prod/web', name: 'web' }, [repo('web'), repo('api')])).toMatchObject({
      repositoryId: 'web',
      because: 'exact_name',
    });
  });

  it('THE RULING: a weak guess is not offered at all', () => {
    // A wrong mapping sends an operator to the wrong diff during an incident, which is worse than none.
    const suggestion = suggestRepository({ id: 'prod/checkout-orchestrator', name: 'checkout-orchestrator' }, [repo('o')]);
    expect(suggestion).toBeNull();
    expect(MIN_SUGGESTION_SCORE).toBeGreaterThan(0.5);
  });

  it('offers at most one, because a shortlist makes the decision harder rather than easier', () => {
    const suggestion = suggestRepository({ id: 'prod/web', name: 'web' }, [repo('web', 'a'), repo('web', 'b')]);
    expect(suggestion?.repositoryId).toBe('a');
  });

  it('says which comparison produced it, so it can be argued with', () => {
    const suggestion = suggestRepository({ id: 'prod/payments', name: 'payments' }, [repo('pay')]);
    if (suggestion !== null) expect(['service_contains_repo', 'repo_contains_service']).toContain(suggestion.because);
  });

  it('suggests nothing when there are no repositories', () => {
    expect(suggestRepository({ id: 'prod/web', name: 'web' }, [])).toBeNull();
  });
});

describe('§J — placing a stack frame, deterministically', () => {
  const mapping = { repositoryId: 'r1', pathPrefix: null };
  const repository = { defaultBranch: 'main' };

  it('keeps the path from the first recognisable source root', () => {
    const located = locateFrame('/app/src/payment/charge.ts', mapping, repository, null);
    expect(located?.path).toBe('src/payment/charge.ts');
  });

  it('applies a monorepo prefix', () => {
    const located = locateFrame('/app/src/charge.ts', { repositoryId: 'r1', pathPrefix: '/services/payments/' }, repository, null);
    expect(located?.path).toBe('services/payments/src/charge.ts');
  });

  it('THE RULING: a dependency frame is declined, not guessed at', () => {
    for (const file of ['/app/node_modules/pg/lib/client.js', 'node:internal/streams', '<anonymous>', '/usr/lib/python3/site-packages/x.py']) {
      expect(locateFrame(file, mapping, repository, null), file).toBeNull();
    }
  });

  it('THE RULING: an absolute path with no recognisable root is declined', () => {
    // A path from a machine nobody here knows is not a repository path, and pretending otherwise would send
    // a reader to a file that does not exist.
    expect(locateFrame('/opt/weird/thing.js', mapping, repository, null)).toBeNull();
  });

  it('THE RULING: without a commit the ref is the branch, and it is marked as moving', () => {
    const floating = locateFrame('src/a.ts', mapping, repository, null);
    expect(floating).toMatchObject({ ref: 'main', refIsMoving: true });

    // §13: a frame without a commit is a guess about line numbers, and the page must say so.
    const pinned = locateFrame('src/a.ts', mapping, repository, 'abc123');
    expect(pinned).toMatchObject({ ref: 'abc123', refIsMoving: false });
  });

  it('declines an empty file', () => {
    expect(locateFrame('   ', mapping, repository, null)).toBeNull();
  });
});

describe('the link a reader follows', () => {
  it('is built from stored fields, so it works without a credential', () => {
    const located = locateFrame('src/a.ts', { repositoryId: 'r1', pathPrefix: null }, { defaultBranch: 'main' }, 'abc123');
    expect(located).not.toBeNull();
    if (located !== null) {
      expect(fileUrl({ owner: 'acme', name: 'web' }, located)).toBe('https://github.com/acme/web/blob/abc123/src/a.ts');
    }
  });

  it('escapes a ref that could otherwise change the path', () => {
    const located = locateFrame('src/a.ts', { repositoryId: 'r1', pathPrefix: null }, { defaultBranch: 'release/1.0' }, null);
    expect(located).not.toBeNull();
    if (located !== null) expect(fileUrl({ owner: 'acme', name: 'web' }, located)).toContain('release%2F1.0');
  });
});
