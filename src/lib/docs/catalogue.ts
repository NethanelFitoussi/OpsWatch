/**
 * The documentation OpsWatch ships with itself.
 *
 * Client-safe and prose-free on purpose: this file is the *structure* — which guides exist, what they are
 * about, what they are called in a URL, and what somebody might type when looking for them. Every sentence
 * lives in the message catalogues under `Docs.guides.<slug>.*`, so the French is real translation rather
 * than an English file with a French name, and so a missing sentence fails the same catalogue test that
 * guards the rest of the product.
 *
 * The audience is somebody who can follow instructions and is **not** an AWS or Kubernetes expert. That
 * is why every guide has the same six parts, in the same order, every time: what it does, what you need
 * first, the steps, how to check it worked, what usually goes wrong, and where to go next. A reader who
 * has read one guide knows the shape of all of them.
 */

export const DOC_CATEGORIES = ['start', 'aws', 'infrastructure', 'code', 'data', 'integrations'] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type DocGuide = {
  slug: string;
  category: DocCategory;
  /**
   * Words somebody would actually type, including the ones the guide does not use itself: an operator
   * searching `save metrics` is looking for historical collection, and a search that only matches a
   * guide's own vocabulary only helps people who already know it.
   */
  keywords: readonly string[];
  /** Where in the product this guide is about, so a guide can offer the thing it just explained. */
  appHref?: string;
  /**
   * A block generated from the code rather than written as prose.
   *
   * The API surface is the one thing a hand-written guide cannot keep up with: a second description of it
   * drifts from the first. Naming it here keeps the structure in this file, where the rest of it lives.
   */
  reference?: 'api';
};

export const DOCS: readonly DocGuide[] = [
  { slug: 'install', category: 'start', keywords: ['install', 'docker', 'compose', 'self-host', 'setup', 'first run', 'port'] },
  { slug: 'first-login', category: 'start', keywords: ['login', 'sign in', 'admin', 'password', 'account', 'google'] },
  { slug: 'reading-status', category: 'start', keywords: ['green', 'healthy', 'warning', 'critical', 'unknown', 'stale', 'colour', 'color', 'why warning', 'status'] },
  { slug: 'problems', category: 'start', keywords: ['problem', 'alert', 'incident', 'severity', 'acknowledge', 'resolve', 'investigate'], appHref: '/overview' },

  { slug: 'connect-aws', category: 'aws', keywords: ['aws', 'cloudformation', 'iam', 'role', 'trust policy', 'external id', 'permissions', 'regions', 'account'], appHref: '/accounts/new/aws' },
  { slug: 'aws-permissions', category: 'aws', keywords: ['aws permissions', 'iam policy', 'read only', 'permission test', 'denied', 'access', 'update permissions'] },
  { slug: 'alarms', category: 'aws', keywords: ['alarm', 'cloudwatch alarm', 'alarms', 'insufficient data', 'in alarm', 'alarm vs problem', 'threshold', 'target tracking'] },
  { slug: 'checkup', category: 'aws', keywords: ['checkup', 'audit', 'findings', 'review', 'configuration'] },

  { slug: 'ecs', category: 'infrastructure', keywords: ['ecs', 'fargate', 'cluster', 'service', 'task', 'container', 'ecs logs', 'ecs memory', 'container insights'] },
  { slug: 'ec2', category: 'infrastructure', keywords: ['ec2', 'instance', 'host', 'status check', 'cpu', 'availability zone', 'detailed monitoring'] },
  { slug: 'kubernetes', category: 'infrastructure', keywords: ['kubernetes', 'eks', 'pod', 'namespace', 'container insights', 'kubernetes monitoring', 'node', 'restart'] },
  { slug: 'redis', category: 'infrastructure', keywords: ['redis', 'elasticache', 'cache', 'redis cpu', 'redis memory', 'engine cpu', 'evictions', 'hit rate', 'connections'] },
  { slug: 'logs', category: 'infrastructure', keywords: ['logs', 'cloudwatch logs', 'log group', 'ecs logs', 'send logs', 'errors'] },
  {
    slug: 'searching-logs',
    category: 'infrastructure',
    keywords: ['search logs', 'find in logs', 'log search', 'logs insights', 'query logs', 'saved search', 'log level', 'grep', 'timeline', 'filter logs'],
    appHref: '/logs/search',
  },

  {
    slug: 'push-collection',
    category: 'aws',
    keywords: ['forwarder', 'push', 'real-time logs', 'lambda', 'subscription filter', 'managed collection', 'streaming', 'live logs', 'ingest', 'send logs to opswatch'],
  },

  { slug: 'connect-github', category: 'code', keywords: ['github', 'connect github', 'repository', 'commit', 'code', 'deployment', 'map service', 'changed files'] },

  { slug: 'history', category: 'data', keywords: ['history', 'historical data', 'save metrics', 'retain', 'retention', 'statistics', 'baseline', 'cost', 'storage', 'backup'] },
  { slug: 'alerts', category: 'data', keywords: ['alerts', 'notifications', 'rules', 'cooldown', 'acknowledge', 'webhook', 'configure alerts', 'weekly summary', 'digest'] },
  {
    slug: 'backup',
    category: 'data',
    keywords: ['backup', 'restore', 'export', 'sqlite', 'database file', 'migrate', 'move to another server', 'disaster recovery', 'snapshot'],
    appHref: '/settings/backup',
  },

  { slug: 'cloudflare', category: 'integrations', keywords: ['cloudflare', 'zone', 'api token', 'cache', 'threats', 'edge', 'traffic'] },
  { slug: 'ai', category: 'integrations', keywords: ['ai', 'openai', 'anthropic', 'model', 'api key', 'ask opswatch', 'hypothesis'] },
  {
    slug: 'api',
    category: 'integrations',
    keywords: ['api', 'rest', 'openapi', 'token', 'bearer', 'integrate', 'script', 'curl', 'endpoints', 'pagination', 'cursor', 'automation'],
    reference: 'api',
  },
] as const;

export const DOC_SLUGS: readonly string[] = DOCS.map((guide) => guide.slug);

export function findGuide(slug: string): DocGuide | null {
  return DOCS.find((guide) => guide.slug === slug) ?? null;
}

export function guidesInCategory(category: DocCategory): DocGuide[] {
  return DOCS.filter((guide) => guide.category === category);
}

export const docPath = (slug: string) => `/docs/${slug}`;

/**
 * Which guides match what somebody typed.
 *
 * Deliberately generous: it matches the title, the summary and the keywords, because an operator looking
 * for "save metrics" does not know the feature is called historical collection. Matching is per word, so
 * "redis cpu" finds the Redis guide on both words rather than requiring the phrase.
 */
export function searchGuides(query: string, text: (slug: string) => { title: string; summary: string }): DocGuide[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [...DOCS];

  const scored = DOCS.map((guide) => {
    const { title, summary } = text(guide.slug);
    const haystack = `${guide.slug} ${title} ${summary} ${guide.keywords.join(' ')}`.toLowerCase();
    const hits = words.filter((word) => haystack.includes(word)).length;
    // A title match is worth more than a passing mention in a summary.
    const titled = words.filter((word) => title.toLowerCase().includes(word)).length;
    return { guide, score: hits * 2 + titled };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => entry.guide);
}
