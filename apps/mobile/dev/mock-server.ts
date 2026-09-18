/**
 * OpsWatch contract mock server, for contributors and integration tests.
 *
 * Serves the /api/v1 contract from the demo dataset over real HTTP, with bearer-token auth, so the app's HTTP client,
 * session handling and polling are exercised end to end without an OpsWatch server or AWS.
 *
 *   npm run mock-server                 # http://localhost:4010, AI enabled
 *   npm run mock-server -- --port 4011 --no-ai --latency 400
 *
 * Sign in with demo@opswatch.dev / opswatch-demo. From an Android emulator the host is http://10.0.2.2:4010.
 * Plain HTTP is only accepted by development builds, after enabling "Allow plain HTTP" on the Connect screen.
 * Fictional data only. Never expose this server beyond your machine or LAN.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AlertFilters, ErrorFilters, LogQuery, ProblemFilters } from '../src/api/client';
import { API_PREFIX, type Favorite, type LogLevel, type Ref, type Severity } from '../src/api/contract';
import * as engine from '../src/demo/engine';
import { buildDemoDataset, DEMO_CREDENTIALS, type DemoDataset } from '../src/demo/fixtures';

export type MockServerOptions = {
  port?: number;
  ai?: boolean;
  latencyMs?: number;
  /** Rejects every authenticated request with 401 after this many, to test session expiry. 0 = never. */
  expireAfter?: number;
};

type Json = Record<string, unknown> | unknown[];

export function createMockServer(options: MockServerOptions = {}): { server: Server; tokens: Set<string> } {
  const tokens = new Set<string>();
  const searches = new Map<string, { query: LogQuery; env?: string; polls: number }>();
  let favorites: Favorite[] = [{ type: 'service', id: 'svc-checkout-api', label: 'checkout-api' }];
  let data: DemoDataset = buildDemoDataset();
  let builtAt = Date.now();
  let authenticatedCalls = 0;

  const fresh = () => {
    if (Date.now() - builtAt > 60_000) {
      data = buildDemoDataset();
      builtAt = Date.now();
    }
    return data;
  };

  const send = (res: ServerResponse, status: number, body?: Json) => {
    // Serialise first, so a serialisation failure still produces a clean 500.
    const payload = body === undefined ? undefined : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(payload);
  };
  const fail = (res: ServerResponse, status: number, error: string, message?: string) => send(res, status, { error, ...(message ? { message } : {}) });

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
        if (raw.length > 100_000) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });

  const found = <T>(res: ServerResponse, item: T | undefined): item is T => {
    if (item === undefined) fail(res, 404, 'not_found');
    return item !== undefined;
  };

  const server = createServer(async (req, res) => {
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (!url.pathname.startsWith(API_PREFIX)) return fail(res, 404, 'not_found');
    const path = url.pathname.slice(API_PREFIX.length) || '/';
    const q = url.searchParams;
    const env = q.get('env') ?? undefined;
    const now = Date.now();
    const d = fresh();

    // Unauthenticated routes.
    if (method === 'GET' && path === '/server') {
      return send(res, 200, { ...d.server, name: 'OpsWatch mock server', version: '0.1.0-mock', features: { ...d.server.features, ai: options.ai !== false } });
    }
    if (method === 'POST' && path === '/auth/login') {
      const body = (await readBody(req)) as { email?: string; password?: string } | undefined;
      if (body?.email?.trim().toLowerCase() !== DEMO_CREDENTIALS.email || body.password !== DEMO_CREDENTIALS.password) {
        return fail(res, 401, 'invalid_credentials');
      }
      const token = randomBytes(24).toString('base64url');
      tokens.add(token);
      return send(res, 200, { token, expiresAt: now + 30 * 86_400_000, user: { email: DEMO_CREDENTIALS.email, name: 'Demo user' } });
    }

    // Everything else requires a valid bearer token.
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !tokens.has(token)) return fail(res, 401, 'unauthorized');
    authenticatedCalls += 1;
    if (options.expireAfter && authenticatedCalls > options.expireAfter) {
      tokens.delete(token);
      return fail(res, 401, 'unauthorized');
    }

    const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [root, id, action] = segments;
    const cursor = q.get('cursor');

    try {
      switch (`${method} ${root}${id ? '/:id' : ''}${action ? `/${action}` : ''}`) {
        case 'POST auth/:id':
          if (id === 'logout') {
            tokens.delete(token);
            return send(res, 204);
          }
          break;
        case 'GET me':
          return send(res, 200, { email: DEMO_CREDENTIALS.email, name: 'Demo user' });
        case 'GET environments':
          return send(res, 200, { items: d.environments });
        case 'GET health':
          return send(res, 200, engine.healthFor(d, env, now));
        case 'GET brief':
          return send(res, 200, engine.briefFor(d, env, now));
        case 'GET problems': {
          const filters: ProblemFilters = {
            status: (q.get('status') as ProblemFilters['status']) ?? undefined,
            severity: q.getAll('severity') as Severity[],
            service: q.get('service') ?? undefined,
            category: q.get('category') ?? undefined,
            since: q.get('since') ? Number(q.get('since')) : undefined,
          };
          return send(res, 200, engine.listProblems(d, env, filters, cursor));
        }
        case 'GET problems/:id': {
          const problem = engine.findById(d.problems, id!);
          return found(res, problem) ? send(res, 200, problem) : undefined;
        }
        case 'POST problems/:id/acknowledge': {
          const problem = engine.findById(d.problems, id!);
          if (!found(res, problem)) return;
          if (!problem.allowedActions.includes('acknowledge')) return fail(res, 403, 'forbidden');
          problem.status = 'acknowledged';
          problem.allowedActions = problem.allowedActions.filter((a) => a !== 'acknowledge');
          return send(res, 204);
        }
        case 'GET errors':
          return send(res, 200, engine.listErrors(d, env, { status: (q.get('status') as ErrorFilters['status']) ?? undefined, service: q.get('service') ?? undefined }, cursor));
        case 'GET errors/:id': {
          const error = engine.findById(d.errors, id!);
          return found(res, error) ? send(res, 200, error) : undefined;
        }
        case 'GET services':
          return send(res, 200, { items: engine.listServices(d, env) });
        case 'GET services/:id': {
          const service = engine.findById(d.services, id!);
          return found(res, service) ? send(res, 200, service) : undefined;
        }
        case 'GET infrastructure':
          return send(res, 200, { items: d.infrastructure.filter((r) => !q.get('category') || r.category === q.get('category')) });
        case 'GET infrastructure/:id': {
          const resource = engine.findById(d.infrastructure, id!);
          return found(res, resource) ? send(res, 200, resource) : undefined;
        }
        case 'POST logs/:id':
          if (id === 'search') {
            const body = ((await readBody(req)) ?? {}) as Partial<LogQuery> & { cursor?: string | null };
            if (typeof body.from !== 'number' || typeof body.to !== 'number' || body.to - body.from > 86_400_000 * 7) return fail(res, 400, 'invalid_query');
            const query: LogQuery = { text: body.text, service: body.service, levels: body.levels as LogLevel[] | undefined, source: body.source, from: body.from, to: body.to };
            const searchId = randomBytes(8).toString('hex');
            searches.set(searchId, { query, env, polls: 0 });
            // Like CloudWatch Logs Insights, the first answer is "running"; the client polls.
            return send(res, 200, { searchId, status: 'running', items: [], nextCursor: null });
          }
          break;
        case 'POST ai/:id':
          if (id === 'ask') {
            if (options.ai === false) return fail(res, 501, 'unsupported');
            const body = ((await readBody(req)) ?? {}) as { question?: string; context?: Ref };
            if (!body.question || body.question.length > 2000) return fail(res, 400, 'invalid_query');
            return send(res, 200, engine.ask(d, body.question, body.context, now));
          }
          break;
        case 'GET alerts':
          return send(res, 200, engine.listAlerts(d, env, { status: (q.get('status') as AlertFilters['status']) ?? undefined }, cursor));
        case 'GET alerts/:id': {
          const alert = engine.findById(d.alerts, id!);
          return found(res, alert) ? send(res, 200, alert) : undefined;
        }
        case 'POST alerts/:id/acknowledge': {
          const alert = engine.findById(d.alerts, id!);
          if (!found(res, alert)) return;
          if (!alert.allowedActions.includes('acknowledge')) return fail(res, 403, 'forbidden');
          alert.status = 'acknowledged';
          alert.acknowledgedBy = DEMO_CREDENTIALS.email;
          alert.acknowledgedAt = now;
          alert.allowedActions = alert.allowedActions.filter((a) => a !== 'acknowledge');
          return send(res, 204);
        }
        case 'GET incidents':
          return send(res, 200, engine.listIncidents(d, env, cursor));
        case 'GET incidents/:id': {
          const incident = engine.findById(d.incidents, id!);
          return found(res, incident) ? send(res, 200, incident) : undefined;
        }
        case 'GET synthetics':
          return send(res, 200, { items: d.synthetics });
        case 'GET synthetics/:id': {
          const synthetic = engine.findById(d.synthetics, id!);
          return found(res, synthetic) ? send(res, 200, synthetic) : undefined;
        }
        case 'GET slos':
          return send(res, 200, { items: d.slos });
        case 'GET slos/:id': {
          const slo = engine.findById(d.slos, id!);
          return found(res, slo) ? send(res, 200, slo) : undefined;
        }
        case 'GET deployments':
          return send(res, 200, engine.listDeployments(d, env, cursor));
        case 'GET deployments/:id': {
          const deployment = engine.findById(d.deployments, id!);
          return found(res, deployment) ? send(res, 200, deployment) : undefined;
        }
        case 'GET investigations/:id': {
          const investigation = engine.findById(d.investigations, id!);
          return found(res, investigation) ? send(res, 200, investigation) : undefined;
        }
        case 'GET search':
          return send(res, 200, { items: engine.search(d, env, q.get('q') ?? '') });
        case 'GET me/:id':
          if (id === 'favorites') return send(res, 200, { items: favorites });
          break;
        case 'PUT me/:id':
          if (id === 'favorites') {
            const body = (await readBody(req)) as { items?: Favorite[] } | undefined;
            if (!Array.isArray(body?.items)) return fail(res, 400, 'invalid_query');
            favorites = body.items.slice(0, 200);
            return send(res, 200, { items: favorites });
          }
          break;
        case 'POST me/:id':
          if (id === 'devices') return fail(res, 501, 'unsupported', 'Push notifications are not configured on this server');
          break;
      }

      // Routes with more segments than the switch shape handles.
      if (method === 'GET' && root === 'logs' && id === 'search' && action) {
        const search = searches.get(action);
        if (!search) return fail(res, 404, 'not_found');
        search.polls += 1;
        const result = engine.searchLogs(d, search.env, search.query, cursor);
        return send(res, 200, { ...result, searchId: action });
      }
      if (method === 'DELETE' && root === 'logs' && id === 'search' && action) {
        searches.delete(action);
        return send(res, 204);
      }
      if (method === 'GET' && root === 'repository' && id === 'evidence' && action) {
        const evidence = engine.findById(d.repository, action);
        return found(res, evidence) ? send(res, 200, evidence) : undefined;
      }
      if (method === 'DELETE' && root === 'me' && id === 'devices' && action) return send(res, 204);
      return fail(res, 404, 'not_found');
    } catch {
      return fail(res, 500, 'server_error');
    }
  });

  return { server, tokens };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const isMain = process.argv[1]?.includes('mock-server') ?? false;
if (isMain && !process.env.JEST_WORKER_ID) {
  const port = Number(argValue('--port') ?? process.env.PORT ?? 4010);
  const { server } = createMockServer({
    ai: !process.argv.includes('--no-ai'),
    latencyMs: Number(argValue('--latency') ?? 0),
    expireAfter: Number(argValue('--expire-after') ?? 0),
  });
  // Loopback by default; pass --host 0.0.0.0 to reach it from a phone on the same LAN.
  const host = argValue('--host') ?? '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`OpsWatch mock server on http://${host}:${port}${API_PREFIX} (demo data)`);
    console.log(`Sign in with ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`);
  });
}
