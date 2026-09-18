/**
 * A minimal fetch over node:http for integration tests. jest-expo swaps the global fetch for Expo's runtime version,
 * which does not work under Node, so tests inject this one through `fetchImpl`. It implements what src/api/http.ts
 * uses: method, headers, body, abort signal, and a response with ok / status / json().
 */
import { request } from 'node:http';

export const nodeFetch = ((input: string | URL, init: RequestInit = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(String(input));
    const req = request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string> | undefined, signal: init.signal ?? undefined },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(raw),
            text: async () => raw,
          } as unknown as Response);
        });
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body as string);
    req.end();
  })) as typeof fetch;
