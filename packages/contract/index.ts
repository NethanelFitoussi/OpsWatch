/**
 * The OpsWatch API contract, version 1 (`/api/v1`), shared by the server, the web app, the mobile app and the CLI.
 *
 * This package is the single source of truth. It was seeded from the mobile agent's `apps/mobile/src/api/contract.ts`
 * and that file stays authoritative field by field: where the server must expose something the mobile file lacks, the
 * field is added as **optional** — never renamed, never removed — so a client written against the older shape keeps
 * working. It exports the zod schemas themselves, not only the inferred types, because every client validates each
 * response at runtime.
 *
 * Rules shared by every schema:
 * - Times are epoch milliseconds.
 * - A metric the server cannot measure is `null`, never `0`. Screens render "No data" for `null`.
 * - Objects are parsed leniently: unknown keys are dropped, and an unknown enum value from a newer server falls back
 *   to a neutral value instead of rejecting the whole response.
 * - Every object that can be acted upon lists the actions the server authorises in `allowedActions`.
 * - Lists answer `{ items, nextCursor }`; see `pagination.ts` for which endpoints are cursored and which are bounded.
 * - No field anywhere holds a token, a key or a secret. The one exception is the token `POST /auth/login` mints, which
 *   is returned once and never again.
 * - Nothing here imports Node, Next, React, a database or a `server-only` module. `tests/unit/contract-purity.test.ts`
 *   walks these files and fails if that ever stops being true.
 */
export * from './primitives';
export * from './pagination';
export * from './api-error';

export * from './authentication';
export * from './authorization';
export * from './server';
export * from './environments';

export * from './health';
export * from './brief';
export * from './problems';
export * from './errors';
export * from './logs';
export * from './services';
export * from './alerts';
export * from './incidents';
export * from './synthetics';
export * from './cloudflare';
export * from './search';
export * from './slos';
export * from './reports';
export * from './checkup';
export * from './deployments';
export * from './deployments-detail';
export * from './repository';
export * from './ai';
export * from './notifications';
export * from './preferences';
export * from './ingest';
