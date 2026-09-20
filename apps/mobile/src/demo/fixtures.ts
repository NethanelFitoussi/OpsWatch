/**
 * Demo data: one coherent, fictional production story used by the in-app demo mode and by the mock server.
 *
 * Story (times relative to `now`): `checkout-api` v2.14.0 is deployed 52 minutes ago. Three minutes later the Aurora
 * writer's connections climb, then its latency, then checkout latency and HTTP 5xx. A new exception appears in
 * checkout. Redis latency is also elevated. The public website stays up. Everything is invented: no real company,
 * account, host or person.
 */
import type {
  AlertDetail,
  ErrorSummary,
  Brief,
  DeploymentDetail,
  Environment,
  ErrorDetail,
  Evidence,
  Health,
  IncidentDetail,
  InfraDetail,
  Investigation,
  LogEntry,
  ProblemDetail,
  RepositoryEvidence,
  Series,
  ServerInfo,
  ServiceDetail,
  SloDetail,
  SyntheticDetail,
} from '@/api/contract';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const DEMO_CREDENTIALS = { email: 'demo@opswatch.dev', password: 'opswatch-demo' } as const;

export type DemoDataset = {
  server: ServerInfo;
  environments: Environment[];
  health: Health;
  brief: Brief;
  problems: ProblemDetail[];
  errors: ErrorDetail[];
  services: ServiceDetail[];
  infrastructure: InfraDetail[];
  logs: LogEntry[];
  alerts: AlertDetail[];
  incidents: IncidentDetail[];
  synthetics: SyntheticDetail[];
  slos: SloDetail[];
  deployments: DeploymentDetail[];
  investigations: Investigation[];
  repository: RepositoryEvidence[];
};

/**
 * The direction a group is moving, read from its own trend series the way the server reads it from hourly rollups:
 * compare the recent level with the earlier one, and call anything inside ±5 % stable. No series means no trend,
 * which is not the same as stable.
 */
export function trendOf(series: ErrorDetail['trend']): ErrorSummary['trend'] {
  const values = series?.points.map((p) => p[1]).filter((v): v is number => v !== null) ?? [];
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const recent = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half);
  if (earlier === 0) return recent > 0 ? 'rising' : 'stable';
  const change = (recent - earlier) / Math.abs(earlier);
  return change > 0.05 ? 'rising' : change < -0.05 ? 'falling' : 'stable';
}

/** An error group as the list sees it: the detail's series becomes the summary's direction. */
export function errorSummaryOf(e: ErrorDetail): ErrorSummary {
  return {
    id: e.id,
    message: e.message,
    type: e.type,
    status: e.status,
    service: e.service,
    route: e.route,
    occurrences: e.occurrences,
    affectedInstances: e.affectedInstances,
    occurrencesWindow: e.occurrencesWindow,
    firstSeenAt: e.firstSeenAt,
    lastSeenAt: e.lastSeenAt,
    statusSince: e.statusSince,
    trend: trendOf(e.trend),
    problemId: e.problemId,
  };
}

/** Deterministic pseudo-random numbers so fixtures (and screenshots) are stable. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** A metric series of `count` points ending at `now`, with an optional step change `stepAt` minutes ago. */
function series(
  label: string,
  unit: Series['unit'],
  now: number,
  opts: { base: number; noise: number; step?: { minutesAgo: number; to: number }; count?: number; everyMin?: number; seed: number; thresholds?: Series['thresholds'] },
): Series {
  const count = opts.count ?? 60;
  const every = (opts.everyMin ?? 2) * MIN;
  const rand = seeded(opts.seed);
  const points: Series['points'] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = now - i * every;
    const stepped = opts.step && now - at <= opts.step.minutesAgo * MIN;
    const base = stepped && opts.step ? opts.step.to : opts.base;
    points.push([at, Math.max(0, Math.round((base + (rand() - 0.5) * 2 * opts.noise) * 100) / 100)]);
  }
  return { label, unit, points, thresholds: opts.thresholds };
}

export function buildDemoDataset(now: number = Date.now()): DemoDataset {
  const t = (minutesAgo: number) => now - minutesAgo * MIN;
  const svc = (id: string, label: string) => ({ type: 'service' as const, id, label });

  const checkout = svc('svc-checkout-api', 'checkout-api');
  const catalog = svc('svc-catalog-api', 'catalog-api');
  const web = svc('svc-storefront-web', 'storefront-web');
  const worker = svc('svc-orders-worker', 'orders-worker');
  const auth = svc('svc-auth-api', 'auth-api');

  const deployCheckout: DeploymentDetail = {
    id: 'dep-checkout-2140',
    service: checkout,
    environment: 'production',
    version: 'v2.14.0',
    at: t(52),
    status: 'completed',
    repository: 'example-shop/checkout-api',
    commit: {
      sha: '8f3c2a91d4e5b6c7a8f9e0d1c2b3a4f5e6d7c8b9',
      message: 'Batch currency lookups when pricing the cart',
      author: 'A. Developer',
      at: t(95),
      url: 'https://github.example.com/example-shop/checkout-api/commit/8f3c2a9',
    },
    description: 'ECS rolling deployment, task definition checkout-api:214. 6 of 6 tasks running.',
    changes: { files: 7, additions: 184, deletions: 61 },
    relatedProblems: [],
    evidence: [],
    allowedActions: ['ai.analyze'],
  };
  const deployCatalog: DeploymentDetail = {
    id: 'dep-catalog-391',
    service: catalog,
    environment: 'production',
    version: 'v3.9.1',
    at: t(26 * 60),
    status: 'completed',
    repository: 'example-shop/catalog-api',
    commit: { sha: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d', message: 'Cache category trees for 5 minutes', author: 'B. Engineer', at: t(27 * 60) },
    relatedProblems: [],
    evidence: [],
    allowedActions: ['ai.analyze'],
  };
  const deployWorker: DeploymentDetail = {
    id: 'dep-worker-118',
    service: worker,
    environment: 'production',
    version: 'v1.18.0',
    at: t(3 * DAY / MIN),
    status: 'rolled_back',
    repository: 'example-shop/orders-worker',
    commit: { sha: 'c0ffee00d15ea5e0badc0de0123456789abcdef0', message: 'Upgrade queue client', author: 'C. Maintainer', at: t(3 * DAY / MIN + 90) },
    relatedProblems: [],
    evidence: [],
    allowedActions: [],
  };

  const repoEvidence: RepositoryEvidence = {
    id: 'ev-repo-checkout-pricing',
    repository: 'example-shop/checkout-api',
    branch: 'main',
    commit: deployCheckout.commit!,
    fileUrl: 'https://github.example.com/example-shop/checkout-api/blob/8f3c2a9/src/pricing/cart-pricing.ts',
    file: 'src/pricing/cart-pricing.ts',
    lines: { start: 41, end: 58 },
    summary: 'The new batched lookup opens one database connection per cart line instead of reusing the pool client.',
    snippet: {
      startLine: 41,
      highlight: [47, 48, 52],
      code: [
        'export async function priceCart(cart: Cart, db: Pool): Promise<PricedCart> {',
        '  const currencies = new Set(cart.lines.map((line) => line.currency));',
        '  const rates = await loadRates([...currencies]);',
        '',
        '  const priced = await Promise.all(',
        '    cart.lines.map(async (line) => {',
        '      const client = await db.connect();',
        '      const product = await client.query(PRODUCT_SQL, [line.productId]);',
        '      const rate = rates[line.currency];',
        '      return {',
        '        ...line,',
        '        unitPrice: product.rows[0].price * rate.value,',
        '      };',
        '    }),',
        '  );',
        '  return { ...cart, lines: priced };',
        '}',
        '',
      ],
    },
    diff: [
      '@@ -44,11 +44,13 @@ export async function priceCart(cart: Cart, db: Pool) {',
      '-  const priced = [];',
      '-  for (const line of cart.lines) {',
      '-    const product = await db.query(PRODUCT_SQL, [line.productId]);',
      '-    priced.push({ ...line, unitPrice: product.rows[0].price * rates[line.currency].value });',
      '-  }',
      '+  const priced = await Promise.all(',
      '+    cart.lines.map(async (line) => {',
      '+      const client = await db.connect();',
      '+      const product = await client.query(PRODUCT_SQL, [line.productId]);',
      '+      const rate = rates[line.currency];',
      '+      return { ...line, unitPrice: product.rows[0].price * rate.value };',
      '+    }),',
      '+  );',
    ].join('\n'),
  };
  deployCheckout.evidence = [repoEvidence];

  const checkoutLatency = series('checkout-api p95 latency', 'ms', now, {
    base: 180, noise: 25, step: { minutesAgo: 45, to: 1240 }, seed: 11, thresholds: { warning: 500, critical: 1000 },
  });
  const checkout5xx = series('checkout-api 5xx rate', 'percent', now, {
    base: 0.2, noise: 0.15, step: { minutesAgo: 43, to: 6.8 }, seed: 12, thresholds: { warning: 1, critical: 5 },
  });
  const dbConnections = series('aurora-main writer connections', 'count', now, {
    base: 140, noise: 12, step: { minutesAgo: 49, to: 890 }, seed: 13, thresholds: { warning: 700, critical: 900 },
  });
  const dbLatency = series('aurora-main write latency', 'ms', now, {
    base: 2.1, noise: 0.4, step: { minutesAgo: 47, to: 18.5 }, seed: 14, thresholds: { warning: 10, critical: 25 },
  });
  const redisLatency = series('sessions-redis latency', 'ms', now, {
    base: 0.6, noise: 0.1, step: { minutesAgo: 180, to: 3.4 }, count: 120, everyMin: 2, seed: 15, thresholds: { warning: 2, critical: 5 },
  });
  const checkoutRequests = series('checkout-api requests', 'per_minute', now, { base: 1850, noise: 140, seed: 16 });

  const investigationTimeline: Evidence[] = [
    { id: 'ev-1', at: t(52), kind: 'fact', type: 'deployment', title: 'checkout-api v2.14.0 deployed', detail: 'Rolling deployment completed, 6/6 tasks running.', ref: { type: 'deployment', id: deployCheckout.id } },
    { id: 'ev-2', at: t(49), kind: 'fact', type: 'metric', title: 'DB connections ↑ 140 → 890', detail: 'aurora-main writer, 97 % of max_connections.', ref: { type: 'infrastructure', id: 'res-aurora-main-writer' }, series: dbConnections },
    { id: 'ev-3', at: t(47), kind: 'fact', type: 'metric', title: 'DB write latency ↑ 2 ms → 18 ms', ref: { type: 'infrastructure', id: 'res-aurora-main-writer' }, series: dbLatency },
    { id: 'ev-4', at: t(45), kind: 'fact', type: 'metric', title: 'checkout latency p95 ↑ 180 ms → 1.2 s', ref: checkout, series: checkoutLatency },
    { id: 'ev-5', at: t(43), kind: 'fact', type: 'metric', title: 'HTTP 5xx ↑ 0.2 % → 6.8 %', ref: checkout, series: checkout5xx },
    { id: 'ev-6', at: t(41), kind: 'fact', type: 'error', title: 'New exception: TypeError in cart pricing', ref: { type: 'error', id: 'err-checkout-currency' } },
    { id: 'ev-7', at: t(38), kind: 'fact', type: 'alarm', title: 'Alarm checkout-5xx-high entered ALARM', ref: { type: 'alert', id: 'al-checkout-5xx' } },
    { id: 'ev-8', at: t(49), kind: 'correlation', type: 'deployment', title: 'Connections started rising 3 min after the deployment', detail: 'Timing only. No other deployment in the preceding 2 hours.', ref: { type: 'deployment', id: deployCheckout.id } },
    { id: 'ev-9', at: t(45), kind: 'correlation', type: 'metric', title: 'checkout latency follows DB latency within 2 min', detail: 'Pearson r = 0.93 over the last 45 minutes.' },
    {
      id: 'ev-10', at: t(40), kind: 'hypothesis', type: 'commit', confidence: 'medium',
      title: 'Connection pool exhaustion caused by the new pricing code',
      detail: 'The changed function acquires a client per cart line and never releases it. Needs confirmation from connection metrics per task.',
      ref: { type: 'evidence', id: repoEvidence.id },
    },
    { id: 'ev-11', at: t(40), kind: 'hypothesis', type: 'metric', confidence: 'low', title: 'Traffic increase', detail: 'Unlikely: request rate is flat (1.8k/min) across the window.' },
  ];

  const problems: ProblemDetail[] = [
    {
      id: 'prb-checkout-5xx',
      title: 'checkout-api is returning HTTP 5xx',
      severity: 'critical',
      status: 'active',
      category: 'load-balancers',
      service: checkout,
      resource: 'app/prod-public-alb',
      firstSeenAt: t(43),
      lastSeenAt: t(1),
      occurrences: 3712,
      trend: 'rising',
      summary: '6.8 % of checkout requests fail (threshold 5 %).',
      description: 'The load balancer reports 5xx responses from the checkout-api target group above the critical threshold for 43 minutes.',
      evidence: investigationTimeline.filter((e) => e.kind === 'fact'),
      errors: [],
      metrics: [checkout5xx, checkoutLatency, checkoutRequests],
      deployments: [{ deployment: deployCheckout, minutesBeforeProblem: 9 }],
      repository: [repoEvidence],
      possibleCauses: investigationTimeline.filter((e) => e.kind === 'hypothesis'),
      alerts: [],
      incident: { type: 'incident', id: 'inc-2291', label: 'INC-2291 Checkout failures' },
      investigationId: 'inv-checkout-5xx',
      allowedActions: ['acknowledge', 'ai.ask'],
    },
    {
      id: 'prb-aurora-connections',
      title: 'aurora-main writer near its connection limit',
      severity: 'critical',
      status: 'new',
      category: 'databases',
      service: checkout,
      resource: 'aurora-main-instance-1',
      firstSeenAt: t(49),
      lastSeenAt: t(2),
      occurrences: null,
      trend: 'stable',
      summary: '890 of 916 connections in use (97 %).',
      evidence: investigationTimeline.filter((e) => e.id === 'ev-2' || e.id === 'ev-3'),
      errors: [],
      metrics: [dbConnections, dbLatency],
      deployments: [{ deployment: deployCheckout, minutesBeforeProblem: 3 }],
      repository: [repoEvidence],
      possibleCauses: investigationTimeline.filter((e) => e.id === 'ev-10'),
      alerts: [],
      investigationId: 'inv-checkout-5xx',
      allowedActions: ['acknowledge', 'ai.ask'],
    },
    {
      id: 'prb-redis-latency',
      title: 'sessions-redis latency elevated',
      severity: 'warning',
      status: 'acknowledged',
      category: 'infrastructure',
      service: auth,
      resource: 'sessions-redis-001',
      firstSeenAt: t(180),
      lastSeenAt: t(3),
      occurrences: null,
      trend: 'stable',
      summary: 'p99 command latency 3.4 ms, usually 0.6 ms.',
      evidence: [{ id: 'ev-r1', at: t(180), kind: 'fact', type: 'metric', title: 'Redis latency ↑ 0.6 ms → 3.4 ms', series: redisLatency, ref: { type: 'infrastructure', id: 'res-sessions-redis' } }],
      errors: [],
      metrics: [redisLatency],
      deployments: [],
      repository: [],
      possibleCauses: [{ id: 'ev-r2', at: t(170), kind: 'hypothesis', type: 'metric', confidence: 'low', title: 'Evictions after memory reached 92 %', detail: 'Evictions started 10 minutes before the latency increase.' }],
      alerts: [],
      allowedActions: ['ai.ask'],
    },
    {
      id: 'prb-orders-worker-cpu',
      title: 'orders-worker CPU above 85 %',
      severity: 'warning',
      status: 'active',
      category: 'containers',
      service: worker,
      resource: 'prod-cluster/orders-worker',
      firstSeenAt: t(95),
      lastSeenAt: t(4),
      occurrences: null,
      trend: 'falling',
      summary: 'Average CPU 88 % over 15 minutes (warning at 85 %).',
      evidence: [],
      errors: [],
      metrics: [series('orders-worker CPU', 'percent', now, { base: 55, noise: 6, step: { minutesAgo: 95, to: 88 }, seed: 21, thresholds: { warning: 85, critical: 95 } })],
      deployments: [],
      repository: [],
      possibleCauses: [],
      alerts: [],
      allowedActions: ['acknowledge', 'ai.ask'],
    },
    {
      id: 'prb-status-ssl',
      title: 'TLS certificate of status.example.com expires in 12 days',
      severity: 'warning',
      status: 'active',
      category: 'synthetics',
      service: web,
      firstSeenAt: t(2 * DAY / MIN),
      lastSeenAt: t(10),
      occurrences: null,
      trend: null,
      evidence: [],
      errors: [],
      metrics: [],
      deployments: [],
      repository: [],
      possibleCauses: [],
      alerts: [],
      allowedActions: ['acknowledge'],
    },
    {
      id: 'prb-catalog-tasks',
      title: 'catalog-api had fewer running tasks than desired',
      severity: 'warning',
      status: 'resolved',
      category: 'containers',
      service: catalog,
      firstSeenAt: t(26 * 60 - 4),
      lastSeenAt: t(26 * 60 - 19),
      occurrences: null,
      trend: null,
      summary: '4 of 6 tasks running for 15 minutes during the v3.9.1 rollout.',
      evidence: [],
      errors: [],
      metrics: [],
      deployments: [{ deployment: deployCatalog, minutesBeforeProblem: 4 }],
      repository: [],
      possibleCauses: [],
      alerts: [],
      allowedActions: [],
    },
  ];
  deployCheckout.relatedProblems = [
    { problem: problems[1]!, minutesAfterDeployment: 3 },
    { problem: problems[0]!, minutesAfterDeployment: 9 },
  ];
  deployCatalog.relatedProblems = [{ problem: problems[5]!, minutesAfterDeployment: 4 }];

  const sampleLogs: LogEntry[] = [];
  const logRand = seeded(99);
  const levels: LogEntry['level'][] = ['info', 'info', 'info', 'warn', 'error', 'debug'];
  const services = ['checkout-api', 'catalog-api', 'orders-worker', 'auth-api', 'storefront-web'];
  for (let i = 0; i < 240; i += 1) {
    const at = now - i * 37_000;
    const service = services[Math.floor(logRand() * services.length)]!;
    const isCheckoutError = service === 'checkout-api' && at > t(43) && logRand() < 0.6;
    const level = isCheckoutError ? 'error' : levels[Math.floor(logRand() * levels.length)]!;
    const requestId = `req-${Math.floor(logRand() * 1e8).toString(16)}`;
    if (isCheckoutError) {
      sampleLogs.push({
        id: `log-${i}`,
        timestamp: at,
        level: 'error',
        service,
        source: '/ecs/checkout-api',
        message: JSON.stringify({
          level: 'error',
          msg: "TypeError: Cannot read properties of undefined (reading 'value')",
          route: 'POST /v1/cart/price',
          duration_ms: 1180 + Math.floor(logRand() * 400),
          request_id: requestId,
          task: `checkout-api/${(i % 6) + 1}`,
        }),
        links: { errorId: 'err-checkout-currency', problemId: 'prb-checkout-5xx', serviceId: checkout.id },
      });
    } else {
      sampleLogs.push({
        id: `log-${i}`,
        timestamp: at,
        level,
        service,
        source: `/ecs/${service}`,
        message:
          level === 'warn'
            ? `slow query took ${200 + Math.floor(logRand() * 600)} ms request_id=${requestId}`
            : level === 'error'
              ? `upstream timeout after 5000 ms calling inventory-api request_id=${requestId}`
              : `${['GET', 'POST'][i % 2]} /v1/${['products', 'cart', 'session', 'orders'][i % 4]} 200 ${20 + Math.floor(logRand() * 90)}ms`,
        fields: { request_id: requestId },
        links: { serviceId: `svc-${service}` },
      });
    }
  }

  const errors: ErrorDetail[] = [
    {
      id: 'err-checkout-currency',
      message: "TypeError: Cannot read properties of undefined (reading 'value')",
      type: 'TypeError',
      status: 'new',
      service: checkout,
      route: 'POST /v1/cart/price',
      occurrences: 2417,
      affectedInstances: 6,
      firstSeenAt: t(41),
      lastSeenAt: t(1),
      problemId: 'prb-checkout-5xx',
      occurrencesWindow: { from: t(41), to: now },
      statusSince: t(41),
      deployments: [{ deployment: deployCheckout, minutesBeforeError: 11 }],
      repository: [repoEvidence],
      instances: ['checkout-api/1', 'checkout-api/2', 'checkout-api/3', 'checkout-api/4', 'checkout-api/5', 'checkout-api/6'],
      frames: [
        { function: 'priceCart.lines.map', file: 'src/pricing/cart-pricing.ts', line: 52, column: 38, inApp: true, context: [
          { line: 50, code: '      const product = await client.query(PRODUCT_SQL, [line.productId]);' },
          { line: 51, code: '      const rate = rates[line.currency];' },
          { line: 52, code: '      return { ...line, unitPrice: product.rows[0].price * rate.value };' },
          { line: 53, code: '    }),' },
        ] },
        { function: 'async Promise.all (index 3)', inApp: false },
        { function: 'priceCart', file: 'src/pricing/cart-pricing.ts', line: 45, column: 18, inApp: true },
        { function: 'CartController.price', file: 'src/http/cart-controller.ts', line: 88, column: 24, inApp: true },
        { function: 'Layer.handle [as handle_request]', file: 'node_modules/express/lib/router/layer.js', line: 95, column: 5, module: 'express', inApp: false },
        { function: 'next', file: 'node_modules/express/lib/router/route.js', line: 149, column: 13, module: 'express', inApp: false },
        { function: 'processTicksAndRejections', file: 'node:internal/process/task_queues', line: 95, column: 5, inApp: false },
      ],
      rawStack: [
        "TypeError: Cannot read properties of undefined (reading 'value')",
        '    at priceCart.lines.map (/app/src/pricing/cart-pricing.ts:52:38)',
        '    at async Promise.all (index 3)',
        '    at priceCart (/app/src/pricing/cart-pricing.ts:45:18)',
        '    at CartController.price (/app/src/http/cart-controller.ts:88:24)',
        '    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)',
        '    at next (/app/node_modules/express/lib/router/route.js:149:13)',
        '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n'),
      sampleLogs: sampleLogs.filter((l) => l.links?.errorId === 'err-checkout-currency').slice(0, 5),
      trend: series('occurrences / 2 min', 'count', now, { base: 0, noise: 0, step: { minutesAgo: 41, to: 115 }, seed: 31 }),
      allowedActions: ['ai.explain'],
    },
    {
      id: 'err-inventory-timeout',
      message: 'UpstreamTimeoutError: inventory-api did not answer within 5000 ms',
      type: 'UpstreamTimeoutError',
      status: 'recurring',
      service: catalog,
      route: 'GET /v1/products/:id',
      occurrences: 184,
      affectedInstances: 3,
      firstSeenAt: t(9 * DAY / MIN),
      lastSeenAt: t(6),
      occurrencesWindow: null,
      deployments: [],
      repository: [],
      instances: ['catalog-api/1', 'catalog-api/2', 'catalog-api/4'],
      frames: [
        { function: 'InventoryClient.fetchStock', file: 'src/clients/inventory.ts', line: 33, column: 11, inApp: true },
        { function: 'ProductService.get', file: 'src/products/service.ts', line: 71, column: 30, inApp: true },
      ],
      rawStack: 'UpstreamTimeoutError: inventory-api did not answer within 5000 ms\n    at InventoryClient.fetchStock (/app/src/clients/inventory.ts:33:11)\n    at ProductService.get (/app/src/products/service.ts:71:30)',
      sampleLogs: [],
      allowedActions: ['ai.explain'],
    },
    {
      id: 'err-worker-ack',
      message: 'QueueAckError: message visibility timeout expired before ack',
      type: 'QueueAckError',
      status: 'regression',
      service: worker,
      occurrences: 57,
      affectedInstances: 2,
      firstSeenAt: t(3 * DAY / MIN),
      lastSeenAt: t(33),
      occurrencesWindow: null,
      // Came back after a quiet day: the regression's clock starts here, not at firstSeenAt.
      statusSince: t(40),
      deployments: [],
      repository: [],
      instances: ['orders-worker/1', 'orders-worker/3'],
      frames: [{ function: 'Consumer.ack', file: 'src/queue/consumer.ts', line: 120, column: 9, inApp: true }],
      sampleLogs: [],
      allowedActions: ['ai.explain'],
    },
    {
      id: 'err-auth-jwt',
      message: 'JsonWebTokenError: jwt malformed',
      type: 'JsonWebTokenError',
      status: 'resolved',
      service: auth,
      route: 'POST /v1/session/refresh',
      occurrences: 12,
      affectedInstances: 1,
      firstSeenAt: t(5 * DAY / MIN),
      lastSeenAt: t(4 * DAY / MIN),
      occurrencesWindow: null,
      deployments: [],
      repository: [],
      instances: ['auth-api/2'],
      frames: [],
      sampleLogs: [],
      allowedActions: [],
    },
  ];
  problems[0]!.errors = [errorSummaryOf(errors[0]!)];

  const alerts: AlertDetail[] = [
    {
      id: 'al-checkout-5xx', name: 'checkout-5xx-high', severity: 'critical', status: 'firing', source: 'CloudWatch alarm',
      reason: 'Threshold Crossed: 3 datapoints [6.8, 6.5, 7.1] were greater than the threshold (5.0).',
      since: t(38), resolvedAt: null, service: checkout, problemId: 'prb-checkout-5xx', incidentId: 'inc-2291',
      condition: 'HTTPCode_Target_5XX rate > 5 % for 3 of 3 minutes', metric: checkout5xx,
      history: [{ at: t(38), status: 'ALARM', reason: 'Threshold crossed' }, { at: t(3 * DAY / MIN), status: 'OK' }],
      allowedActions: ['acknowledge'],
    },
    {
      id: 'al-aurora-connections', name: 'aurora-main-connections', severity: 'critical', status: 'firing', source: 'CloudWatch alarm',
      reason: 'Threshold Crossed: DatabaseConnections 890 > 800.', since: t(46), resolvedAt: null, service: checkout, problemId: 'prb-aurora-connections',
      condition: 'DatabaseConnections > 800 for 5 minutes', metric: dbConnections,
      history: [{ at: t(46), status: 'ALARM' }], allowedActions: ['acknowledge'],
    },
    {
      id: 'al-redis-latency', name: 'sessions-redis-latency', severity: 'warning', status: 'acknowledged', source: 'CloudWatch alarm',
      reason: 'Threshold Crossed: latency 3.4 ms > 2 ms.', since: t(175), resolvedAt: null, service: auth, problemId: 'prb-redis-latency',
      acknowledgedBy: 'demo@opswatch.dev', acknowledgedAt: t(160), metric: redisLatency,
      history: [{ at: t(175), status: 'ALARM' }, { at: t(160), status: 'ACKNOWLEDGED' }], allowedActions: [],
    },
    {
      id: 'al-worker-cpu', name: 'orders-worker-cpu', severity: 'warning', status: 'firing', source: 'CloudWatch alarm',
      reason: 'Threshold Crossed: CPUUtilization 88 > 85.', since: t(90), resolvedAt: null, service: worker, problemId: 'prb-orders-worker-cpu',
      history: [{ at: t(90), status: 'ALARM' }], allowedActions: ['acknowledge'],
    },
    {
      id: 'al-catalog-tasks', name: 'catalog-api-running-tasks', severity: 'warning', status: 'resolved', source: 'CloudWatch alarm',
      since: t(26 * 60 - 4), resolvedAt: t(26 * 60 - 19), service: catalog, history: [{ at: t(26 * 60 - 4), status: 'ALARM' }, { at: t(26 * 60 - 19), status: 'OK' }], allowedActions: [],
    },
    {
      // No start time and no service: a composite alarm the provider reports without either. The app must not
      // invent a duration or a subject for it.
      id: 'al-composite-region', name: 'eu-west-1-composite', severity: 'warning', status: 'insufficient_data',
      source: 'CloudWatch composite alarm', reason: 'Insufficient data for one of the child alarms.',
      since: null, resolvedAt: null, history: [], allowedActions: [],
    },
  ];
  problems[0]!.alerts = [alerts[0]!];
  problems[1]!.alerts = [alerts[1]!];

  const incidents: IncidentDetail[] = [
    {
      id: 'inc-2291', title: 'INC-2291 Checkout failures after v2.14.0', severity: 'critical', status: 'investigating',
      startedAt: t(40), resolvedAt: null, affectedServices: [checkout],
      summary: 'Customers see errors when pricing their cart. Database connections saturated.',
      timeline: [
        { at: t(40), type: 'opened', text: 'Incident opened from alarm checkout-5xx-high', ref: { type: 'alert', id: 'al-checkout-5xx' } },
        { at: t(35), type: 'status', text: 'Status changed to investigating' },
        { at: t(30), type: 'note', text: 'Rollback of checkout-api to v2.13.2 being prepared' },
      ],
      problems: [problems[0]!, problems[1]!],
      notes: [{ at: t(30), author: 'On-call', text: 'Rollback of checkout-api to v2.13.2 being prepared.' }],
      allowedActions: ['ai.summarize'],
    },
    {
      id: 'inc-2288', title: 'INC-2288 Catalog rollout short on tasks', severity: 'warning', status: 'resolved',
      startedAt: t(26 * 60 - 4), resolvedAt: t(26 * 60 - 19), affectedServices: [catalog],
      timeline: [
        { at: t(26 * 60 - 4), type: 'opened', text: 'Incident opened' },
        { at: t(26 * 60 - 19), type: 'resolved', text: 'All 6 tasks running' },
      ],
      problems: [problems[5]!], notes: [], resolution: 'Rollout completed after a task failed its first health check.', allowedActions: ['ai.summarize'],
    },
  ];

  const uptimeBuckets = (downFrom: number | null, seed: number) => {
    const rand = seeded(seed);
    return Array.from({ length: 48 }, (_, i) => {
      const at = now - (47 - i) * 30 * MIN;
      const up = downFrom !== null && now - at <= downFrom * MIN ? rand() > 0.4 : true;
      return { at, up };
    });
  };

  const synthetics: SyntheticDetail[] = [
    {
      id: 'syn-storefront', name: 'Storefront home', kind: 'http', target: 'https://shop.example.com/', status: 'up',
      availability24h: 1, uptime30d: 0.9997, latencyMs: 212, lastCheckedAt: t(1),
      ssl: { valid: true, expiresAt: now + 64 * DAY, issuer: 'Example CA' },
      latency: series('latency', 'ms', now, { base: 210, noise: 30, seed: 41 }), availability: uptimeBuckets(null, 41), failures: [],
    },
    {
      id: 'syn-checkout-api', name: 'Checkout API', kind: 'api', target: 'https://api.example.com/v1/cart/price', status: 'degraded',
      availability24h: 0.962, uptime30d: 0.9981, latencyMs: 1310, lastCheckedAt: t(1),
      ssl: { valid: true, expiresAt: now + 64 * DAY, issuer: 'Example CA' },
      latency: series('latency', 'ms', now, { base: 190, noise: 30, step: { minutesAgo: 45, to: 1300 }, seed: 42, thresholds: { warning: 800 } }),
      availability: uptimeBuckets(45, 42),
      failures: [
        { at: t(3), reason: 'HTTP 502 from api.example.com', statusCode: 502, location: 'eu-west-1' },
        { at: t(11), reason: 'Timeout after 10 s', location: 'us-east-1' },
        { at: t(24), reason: 'HTTP 500 from api.example.com', statusCode: 500, location: 'eu-west-1' },
      ],
      problem: { type: 'problem', id: 'prb-checkout-5xx' },
    },
    {
      id: 'syn-status', name: 'Status page', kind: 'http', target: 'https://status.example.com/', status: 'up',
      availability24h: 1, uptime30d: 1, latencyMs: 98, lastCheckedAt: t(2),
      ssl: { valid: true, expiresAt: now + 12 * DAY + HOUR * 12, issuer: 'Example CA' },
      latency: series('latency', 'ms', now, { base: 95, noise: 12, seed: 43 }), availability: uptimeBuckets(null, 43), failures: [],
      problem: { type: 'problem', id: 'prb-status-ssl' },
    },
    {
      id: 'syn-login', name: 'Sign-in API', kind: 'api', target: 'https://api.example.com/v1/session', status: 'up',
      availability24h: 0.999, uptime30d: 0.9995, latencyMs: 164, lastCheckedAt: t(1),
      ssl: { valid: true, expiresAt: now + 64 * DAY, issuer: 'Example CA' },
      latency: series('latency', 'ms', now, { base: 160, noise: 20, seed: 44 }), availability: uptimeBuckets(null, 44), failures: [],
    },
    {
      // Just created, never executed: everything the app would show is genuinely unknown.
      id: 'syn-admin', name: 'Admin console', kind: 'http', target: 'https://admin.example.com/', status: 'unknown',
      availability24h: null, uptime30d: null, latencyMs: null, lastCheckedAt: null, ssl: null,
      availability: [], failures: [],
    },
  ];

  const slos: SloDetail[] = [
    {
      id: 'slo-checkout-availability', name: 'Checkout availability', service: checkout, target: 0.999, current: 0.9962, window: '30 days',
      budgetRemaining: -2.8, burnRate: 14.2, status: 'breached',
      description: 'Share of checkout requests answered without a 5xx.',
      performance: series('availability', 'ratio', now, { base: 0.9995, noise: 0.0002, step: { minutesAgo: 45, to: 0.9962 }, seed: 51, thresholds: { warning: 0.999 } }),
      budget: series('budget remaining', 'ratio', now, { base: 0.62, noise: 0.01, step: { minutesAgo: 45, to: -2.8 }, seed: 52 }),
    },
    {
      id: 'slo-checkout-latency', name: 'Checkout latency p95 < 500 ms', service: checkout, target: 0.99, current: 0.981, window: '30 days',
      budgetRemaining: 0.12, burnRate: 6.1, status: 'at_risk',
      performance: series('good requests', 'ratio', now, { base: 0.995, noise: 0.001, step: { minutesAgo: 45, to: 0.981 }, seed: 53 }),
    },
    {
      id: 'slo-storefront', name: 'Storefront availability', service: web, target: 0.9995, current: 0.9998, window: '30 days',
      budgetRemaining: 0.64, burnRate: 0.4, status: 'healthy',
      performance: series('availability', 'ratio', now, { base: 0.9998, noise: 0.0001, seed: 54 }),
    },
    { id: 'slo-auth', name: 'Sign-in success', service: auth, target: 0.999, current: null, window: '30 days', budgetRemaining: null, burnRate: null, status: 'unknown', description: 'Not enough data yet: the SLO was created 2 hours ago.' },
  ];

  const infrastructure: InfraDetail[] = [
    {
      id: 'res-aurora-main-writer', name: 'aurora-main-instance-1', category: 'rds', health: 'critical', status: 'available',
      summary: 'Aurora PostgreSQL 16.4, writer, db.r7g.xlarge',
      keyMetrics: [
        { label: 'Connections', value: { value: 890, unit: 'count', status: 'critical' } },
        { label: 'CPU', value: { value: 71, unit: 'percent', status: 'ok' } },
        { label: 'Write latency', value: { value: 18.5, unit: 'ms', status: 'warning' } },
      ],
      anomalies: ['Connections 6× usual level', 'Write latency 9× usual level'],
      properties: [
        { label: 'Engine', value: 'aurora-postgresql 16.4' }, { label: 'Class', value: 'db.r7g.xlarge' },
        { label: 'Role', value: 'writer' }, { label: 'Availability zone', value: 'eu-west-1a' }, { label: 'Performance Insights', value: 'enabled' },
      ],
      series: [dbConnections, dbLatency], related: [checkout], problems: [problems[1]!],
    },
    {
      id: 'res-aurora-main-reader', name: 'aurora-main-instance-2', category: 'rds', health: 'healthy', status: 'available',
      summary: 'Aurora PostgreSQL 16.4, reader, db.r7g.large',
      keyMetrics: [
        { label: 'CPU', value: { value: 22, unit: 'percent', status: 'ok' } },
        { label: 'Replica lag', value: { value: 18, unit: 'ms', status: 'ok' } },
      ],
      anomalies: [], properties: [{ label: 'Role', value: 'reader' }], series: [], related: [catalog], problems: [],
    },
    {
      id: 'res-sessions-redis', name: 'sessions-redis-001', category: 'redis', health: 'degraded', status: 'available',
      summary: 'ElastiCache Redis 7.1, cache.r7g.large',
      keyMetrics: [
        { label: 'Latency', value: { value: 3.4, unit: 'ms', status: 'warning' } },
        { label: 'Memory', value: { value: 92, unit: 'percent', status: 'warning' } },
        { label: 'Evictions', value: { value: 1240, unit: 'per_minute', status: 'warning' } },
      ],
      anomalies: ['Evictions since 3 h'], properties: [{ label: 'Engine', value: 'redis 7.1' }], series: [redisLatency], related: [auth], problems: [problems[2]!],
    },
    {
      id: 'res-prod-cluster-checkout', name: 'prod-cluster / checkout-api', category: 'ecs', health: 'degraded', status: 'ACTIVE',
      summary: '6/6 tasks, Fargate, task definition checkout-api:214',
      keyMetrics: [
        { label: 'CPU', value: { value: 64, unit: 'percent', status: 'ok' } },
        { label: 'Memory', value: { value: 58, unit: 'percent', status: 'ok' } },
        { label: 'Tasks', value: { value: 6, unit: 'count', status: 'ok' } },
      ],
      anomalies: [], properties: [{ label: 'Launch type', value: 'FARGATE' }, { label: 'Desired', value: '6' }], series: [], related: [checkout], problems: [],
    },
    {
      id: 'res-prod-cluster-worker', name: 'prod-cluster / orders-worker', category: 'ecs', health: 'degraded', status: 'ACTIVE',
      summary: '3/3 tasks, Fargate',
      keyMetrics: [{ label: 'CPU', value: { value: 88, unit: 'percent', status: 'warning' } }, { label: 'Memory', value: { value: 61, unit: 'percent', status: 'ok' } }],
      anomalies: ['CPU above 85 % for 95 min'], properties: [], series: [], related: [worker], problems: [problems[3]!],
    },
    {
      id: 'res-prod-public-alb', name: 'prod-public-alb', category: 'load-balancer', health: 'critical', status: 'active',
      summary: 'Application load balancer, internet-facing, 4 target groups',
      keyMetrics: [
        { label: '5xx rate', value: { value: 2.1, unit: 'percent', status: 'warning' } },
        { label: 'p95', value: { value: 640, unit: 'ms', status: 'warning' } },
        { label: 'Unhealthy hosts', value: { value: 0, unit: 'count', status: 'ok' } },
      ],
      anomalies: ['5xx concentrated on target group checkout-api'], properties: [{ label: 'Scheme', value: 'internet-facing' }], series: [checkout5xx], related: [checkout, catalog, web], problems: [problems[0]!],
    },
    {
      id: 'res-bastion', name: 'bastion-1', category: 'ec2', health: 'healthy', status: 'running', summary: 't4g.micro',
      keyMetrics: [{ label: 'CPU', value: { value: 2, unit: 'percent', status: 'ok' } }], anomalies: [], properties: [], series: [], related: [], problems: [],
    },
    {
      id: 'res-assets-bucket', name: 'shop-assets', category: 'storage', health: 'unknown', status: undefined, summary: 'S3 bucket. Request metrics are not enabled.',
      keyMetrics: [{ label: 'Requests', value: { value: null, unit: 'per_minute', status: null } }], anomalies: [], properties: [], series: [], related: [web], problems: [],
    },
    {
      // Discovered, but this server collects no metric for it: the screen must say so rather than look half-loaded.
      id: 'res-legacy-elb', name: 'legacy-classic-elb', category: 'load-balancer', health: 'unknown', status: undefined,
      summary: 'Classic load balancer. OpsWatch has no metric for it on this server.',
      keyMetrics: [], anomalies: [], properties: [], series: [], related: [], problems: [],
    },
    {
      id: 'res-nat', name: 'nat-eu-west-1a', category: 'network', health: 'healthy', status: 'available', summary: 'NAT gateway',
      keyMetrics: [{ label: 'Dropped packets', value: { value: 0, unit: 'count', status: 'ok' } }], anomalies: [], properties: [], series: [], related: [], problems: [],
    },
  ];

  const svcDetail = (
    ref: { id: string; label: string },
    health: ServiceDetail['health'],
    m: { err: number | null; p95: number | null; rpm: number | null },
    extra: Partial<ServiceDetail>,
  ): ServiceDetail => ({
    id: ref.id,
    name: ref.label,
    kind: 'ECS service',
    health,
    errorRate: { value: m.err, unit: 'percent', status: m.err === null ? null : m.err >= 5 ? 'critical' : m.err >= 1 ? 'warning' : 'ok' },
    latencyP95: { value: m.p95, unit: 'ms', status: m.p95 === null ? null : m.p95 >= 1000 ? 'critical' : m.p95 >= 500 ? 'warning' : 'ok' },
    requests: { value: m.rpm, unit: 'per_minute', status: null },
    openProblems: 0,
    firingAlerts: 0,
    series: [],
    infrastructure: [],
    dependencies: [],
    deployments: [],
    problems: [],
    alerts: [],
    allowedActions: ['ai.analyze'],
    ...extra,
  });

  const servicesList: ServiceDetail[] = [
    svcDetail(checkout, 'critical', { err: 6.8, p95: 1240, rpm: 1850 }, {
      description: 'Prices carts and takes payments.',
      openProblems: 2, firingAlerts: 2,
      series: [checkout5xx, checkoutLatency, checkoutRequests],
      infrastructure: [infrastructure[3]!, infrastructure[0]!, infrastructure[5]!],
      dependencies: [{ ref: { type: 'infrastructure', id: 'res-aurora-main-writer', label: 'aurora-main (writer)' }, health: 'critical' }, { ref: { type: 'service', id: auth.id, label: auth.label }, health: 'degraded' }],
      deployments: [deployCheckout], problems: [problems[0]!, problems[1]!], alerts: [alerts[0]!, alerts[1]!],
    }),
    svcDetail(worker, 'degraded', { err: null, p95: null, rpm: null }, {
      kind: 'ECS worker', description: 'Consumes order events. Not behind a load balancer, so no HTTP metrics.',
      openProblems: 1, firingAlerts: 1, infrastructure: [infrastructure[4]!], deployments: [deployWorker], problems: [problems[3]!], alerts: [alerts[3]!],
    }),
    svcDetail(auth, 'degraded', { err: 0.1, p95: 140, rpm: 620 }, {
      openProblems: 1, firingAlerts: 0, infrastructure: [infrastructure[2]!], dependencies: [{ ref: { type: 'infrastructure', id: 'res-sessions-redis', label: 'sessions-redis' }, health: 'degraded' }], problems: [problems[2]!],
    }),
    svcDetail(catalog, 'healthy', { err: 0.3, p95: 210, rpm: 4200 }, { deployments: [deployCatalog], dependencies: [{ ref: { type: 'infrastructure', id: 'res-aurora-main-reader', label: 'aurora-main (reader)' }, health: 'healthy' }] }),
    svcDetail(web, 'healthy', { err: 0, p95: 180, rpm: 9800 }, { kind: 'ECS service (web)' }),
    ...['search-api', 'recommendations-api', 'notifications-worker', 'media-resizer', 'admin-web', 'pricing-rules', 'webhooks-api', 'export-worker', 'reviews-api', 'gift-cards-api', 'loyalty-api', 'shipping-api', 'tax-api'].map((name, i) =>
      svcDetail({ id: `svc-${name}`, label: name }, 'healthy', name.endsWith('worker') || name.endsWith('resizer') ? { err: null, p95: null, rpm: null } : { err: 0.1 * (i % 3), p95: 90 + i * 11, rpm: 300 + i * 70 }, {
        kind: name.endsWith('worker') || name.endsWith('resizer') ? 'ECS worker' : 'ECS service',
      }),
    ),
  ];

  const deployAuth: DeploymentDetail = {
    // No commit and no repository: this service's images are not tagged with a resolvable sha, so OpsWatch can time
    // the deployment but cannot say what changed in it.
    id: 'dep-auth-77',
    service: auth,
    environment: 'production',
    version: 'build-770',
    at: t(8 * 60),
    status: 'completed',
    relatedProblems: [],
    evidence: [],
    allowedActions: [],
  };

  const deployments = [deployCheckout, deployCatalog, deployWorker, deployAuth];

  const investigations: Investigation[] = [
    {
      id: 'inv-checkout-5xx',
      title: 'Checkout 5xx and database connection saturation',
      subject: { type: 'problem', id: 'prb-checkout-5xx' },
      status: 'open',
      startedAt: t(43),
      summary: 'Facts line up behind the checkout-api v2.14.0 deployment. The link between the deployment and the saturation is a correlation that still needs confirming.',
      timeline: investigationTimeline,
    },
  ];

  const healthyServices = servicesList.filter((s) => s.health === 'healthy').length;
  const counts = { critical: 2, warning: 3, healthyServices, totalServices: servicesList.length };

  const changes: Health['changes'] = [
    { id: 'chg-1', at: t(43), direction: 'up', severity: 'critical', text: 'checkout-api errors increased from 0.2 % to 6.8 %', ref: { type: 'problem', id: 'prb-checkout-5xx' } },
    { id: 'chg-2', at: t(41), direction: 'new', severity: 'critical', text: "New exception: TypeError in cart pricing (2,417 times)", ref: { type: 'error', id: 'err-checkout-currency' } },
    { id: 'chg-3', at: t(180), direction: 'up', severity: 'warning', text: 'Redis latency increased from 0.6 ms to 3.4 ms', ref: { type: 'problem', id: 'prb-redis-latency' } },
    { id: 'chg-4', at: t(1), direction: 'stable', text: 'Website remained available (100 % over 24 h)', ref: { type: 'synthetic', id: 'syn-storefront' } },
    { id: 'chg-5', at: t(26 * 60 - 19), direction: 'resolved', text: 'catalog-api task shortfall resolved after 15 min', ref: { type: 'incident', id: 'inc-2288' } },
  ];

  const health: Health = {
    generatedAt: t(0.5),
    status: 'degraded',
    headline: 'Checkout is failing for about 7 % of requests.',
    counts,
    families: [
      { family: 'ecs', label: 'Containers', status: 'degraded', total: 18, affected: 2 },
      { family: 'rds', label: 'Databases', status: 'critical', total: 2, affected: 1 },
      { family: 'alb', label: 'Load balancers', status: 'critical', total: 2, affected: 1 },
      { family: 'alarms', label: 'Alarms', status: 'critical', total: 24, affected: 3 },
      { family: 'redis', label: 'Redis', status: 'degraded', total: 1, affected: 1 },
      { family: 'cloudfront', label: 'CDN', status: 'unknown', total: null, affected: null, unavailable: { reason: 'denied', code: 'AccessDenied', message: 'The IAM role cannot list CloudFront distributions.' } },
    ],
    topProblem: problems[0]!,
    activeAlerts: alerts.filter((a) => a.status === 'firing').length,
    synthetics: { up: 3, down: 0, degraded: 1 },
    recentIncidents: incidents.map(({ id, title, severity, status, startedAt, resolvedAt, affectedServices }) => ({ id, title, severity, status, startedAt, resolvedAt, affectedServices })),
    recentDeployments: deployments.map(({ id, service, environment, version, at, status, commit, repository }) => ({ id, service, environment, version, at, status, commit, repository })),
    changes,
  };

  const brief: Brief = {
    generatedAt: t(0.5),
    period: { from: now - DAY, to: now },
    status: 'degraded',
    counts,
    changes,
    mostImportant: problems[0]!,
  };

  // Nested objects are summaries, as in the contract. This also keeps the dataset free of reference cycles, so it
  // serialises to JSON exactly like a real server response would.
  const toProblemSummary = ({ id, title, severity, status, category, service, resource, firstSeenAt, lastSeenAt, occurrences, trend, summary }: ProblemDetail) => ({
    id, title, severity, status, category, service, resource, firstSeenAt, lastSeenAt, occurrences, trend, summary,
  });
  const toDeploymentSummary = ({ id, service, environment, version, at, status, commit, repository }: DeploymentDetail) => ({
    id, service, environment, version, at, status, commit, repository,
  });
  for (const problem of problems) {
    problem.deployments = problem.deployments.map((d) => ({ ...d, deployment: toDeploymentSummary(d.deployment as DeploymentDetail) }));
  }
  for (const error of errors) {
    error.deployments = error.deployments.map((d) => ({ ...d, deployment: toDeploymentSummary(d.deployment as DeploymentDetail) }));
  }
  for (const deployment of deployments) {
    deployment.relatedProblems = deployment.relatedProblems.map((r) => ({ ...r, problem: toProblemSummary(r.problem as ProblemDetail) }));
  }
  for (const incident of incidents) incident.problems = incident.problems.map((p) => toProblemSummary(p as ProblemDetail));
  for (const service of servicesList) service.problems = service.problems.map((p) => toProblemSummary(p as ProblemDetail));
  for (const resource of infrastructure) resource.problems = resource.problems.map((p) => toProblemSummary(p as ProblemDetail));
  health.topProblem = health.topProblem && toProblemSummary(health.topProblem as ProblemDetail);
  brief.mostImportant = brief.mostImportant && toProblemSummary(brief.mostImportant as ProblemDetail);

  return {
    server: {
      product: 'opswatch',
      version: '0.1.0-demo',
      apiVersion: 1,
      name: 'OpsWatch demo',
      demo: true,
      auth: { password: true, google: false },
      features: {
        health: true, brief: true, problems: true, errors: true, services: true, infrastructure: true, logs: true, alerts: true,
        incidents: true, synthetics: true, slos: true, deployments: true, investigations: true, repository: true, ai: true,
        search: true, favorites: true, environments: true, push: false,
      },
    },
    environments: [
      { id: 'prod-eu-west-1', name: 'Production', kind: 'production', description: 'AWS eu-west-1' },
      { id: 'staging-eu-west-1', name: 'Staging', kind: 'staging', description: 'AWS eu-west-1' },
      { id: 'dev-eu-west-3', name: 'Development', kind: 'development', description: 'AWS eu-west-3' },
    ],
    health,
    brief,
    problems,
    errors,
    services: servicesList,
    infrastructure,
    logs: sampleLogs,
    alerts,
    incidents,
    synthetics,
    slos,
    deployments,
    investigations,
    repository: [repoEvidence],
  };
}

/** A calm environment for staging and development, so switching environments visibly changes the data. */
export function calmHealth(now: number = Date.now()): Health {
  return {
    generatedAt: now - 30_000,
    status: 'healthy',
    headline: 'All checks passing.',
    counts: { critical: 0, warning: 0, healthyServices: 9, totalServices: 9 },
    families: [
      { family: 'ecs', label: 'Containers', status: 'healthy', total: 9, affected: 0 },
      { family: 'rds', label: 'Databases', status: 'healthy', total: 1, affected: 0 },
      { family: 'alb', label: 'Load balancers', status: 'healthy', total: 1, affected: 0 },
      { family: 'alarms', label: 'Alarms', status: 'healthy', total: 6, affected: 0 },
    ],
    topProblem: null,
    activeAlerts: 0,
    synthetics: null,
    recentIncidents: [],
    recentDeployments: [],
    changes: [{ id: 'calm-1', direction: 'stable', text: 'No change worth reporting in the last 24 hours.' }],
  };
}
