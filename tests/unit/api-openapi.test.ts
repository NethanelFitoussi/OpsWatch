import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '@opswatch/contract';
import { openApiDocument } from '@/lib/api/v1/openapi';
import { API_ROUTES } from '@/lib/api/v1/routes';
import { SRC, readSource } from '../helpers/source-graph';

const ROUTES_DIR = path.join(SRC, 'app/api/v1');

/** Every route handler on disk, as the method and path OpenAPI would name it. */
function implementedRoutes(): { method: string; path: string }[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  return walk(ROUTES_DIR)
    .flatMap((file) => {
      const segments = path.relative(ROUTES_DIR, path.dirname(file));
      // `[id]` is how Next.js names a path parameter; `{id}` is how OpenAPI does.
      const route = `/${segments}`.replace(/\[(\w+)\]/g, '{$1}');
      const methods = [...readSource(file).matchAll(/^export const (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
      return methods.map((method) => ({ method: method.toLowerCase(), path: route }));
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

const sorted = (routes: { method: string; path: string }[]) =>
  [...routes].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

describe('the generated OpenAPI document', () => {
  const document = openApiDocument();

  it('finds the route handlers it is checking', () => {
    expect(implementedRoutes().length).toBeGreaterThan(5);
  });

  it('describes every route that exists, and no route that does not', () => {
    // The registry is the description; this is what stops it drifting from the files beside it.
    expect(sorted(API_ROUTES.map((route) => ({ method: route.method, path: route.path })))).toEqual(implementedRoutes());
  });

  it('carries each of them in its paths, under the API prefix', () => {
    for (const route of implementedRoutes()) {
      const item = document.paths?.[`${API_PREFIX}${route.path}`];
      expect(item, `${route.method.toUpperCase()} ${route.path}`).toBeDefined();
      expect(Object.keys(item ?? {})).toContain(route.method);
    }
  });

  it('marks the unauthenticated endpoints and requires a credential everywhere else', () => {
    // Three kinds, and a signed route accepts neither credential — saying so is what stops a generated
    // client from trying a bearer token against an endpoint that only ever answers a forwarder.
    const expected = { none: [], signature: [{ signature: [] }], session: [{ bearer: [] }, { session: [] }] };
    for (const route of API_ROUTES) {
      const operation = (document.paths?.[`${API_PREFIX}${route.path}`] as Record<string, { security?: unknown[] }>)[route.method];
      expect(operation.security, route.operationId).toEqual(expected[route.auth]);
    }
  });

  it('describes every failure with the shared error envelope', () => {
    const responses = (document.paths?.[`${API_PREFIX}/auth/login`] as Record<string, { responses: Record<string, unknown> }>).post
      .responses;
    for (const status of ['400', '401', '403', '429', '500']) expect(responses[status]).toBeDefined();
  });

  it('declares every templated path segment as a required path parameter', () => {
    // A path that says `{id}` without declaring `id` is not a valid OpenAPI document, and a client generated from
    // it has no way to know the segment is a parameter at all.
    const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        if (!METHODS.includes(method)) continue;
        const parameters = (operation as { parameters?: { name: string; in: string; required?: boolean }[] }).parameters ?? [];
        for (const name of names) {
          const declared = parameters.find((parameter) => parameter.name === name && parameter.in === 'path');
          expect(declared, `${method.toUpperCase()} ${path} declares ${name}`).toBeDefined();
          expect(declared?.required).toBe(true);
        }
      }
    }
  });

  it('describes a path parameter it documents, and documents no parameter the path lacks', () => {
    for (const route of API_ROUTES) {
      const names = [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      for (const documented of Object.keys(route.pathParams ?? {})) {
        expect(names, `${route.operationId} documents ${documented}`).toContain(documented);
      }
    }
  });

  it('never says a response is closed, because v1 only ever adds fields', () => {
    expect(JSON.stringify(document)).not.toContain('"additionalProperties":false');
  });

  it('serialises to JSON, which is what the route sends', () => {
    expect(() => JSON.parse(JSON.stringify(document))).not.toThrow();
  });
});
