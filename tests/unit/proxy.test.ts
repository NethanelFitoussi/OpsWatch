import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe('proxy', () => {
  it('redirects / to English by default', () => {
    const res = proxy(request('/'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('redirects / to the saved locale', () => {
    const res = proxy(request('/', 'NEXT_LOCALE=fr'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/fr');
  });

  it('ignores an unsupported saved locale and the Accept-Language header', () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: { cookie: 'NEXT_LOCALE=de', 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    expect(proxy(req).headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('adds the default prefix to an unprefixed path', () => {
    const res = proxy(request('/getting-started'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/en/getting-started');
  });

  it('lets prefixed paths through', () => {
    const res = proxy(request('/fr/getting-started'));
    expect(res.headers.get('location')).toBeNull();
  });
});
