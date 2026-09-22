/**
 * The OpsWatch API contract, version 1 (`/api/v1`).
 *
 * This file used to hold the contract. It no longer does: the canonical copy is `packages/contract` at the repository
 * root, shared by the server, the web app and this app, and this is a re-export of it. Nothing about the shapes is
 * decided here any more.
 *
 * It stays as a file rather than every screen importing `@opswatch/contract` directly for two reasons. Every import
 * in the app already points at `@/api/contract`, and a re-export keeps that true; and it is the one place to reach
 * for if this app ever needs to narrow something the package exposes more loosely. Adding a *shape* here would
 * recreate the second contract this branch spent weeks removing — if the app needs a field, it goes in the package.
 *
 * What the package guarantees, and the app relies on:
 * - Times are epoch milliseconds.
 * - A metric the server cannot measure is `null`, never `0`. Screens render "No data" for `null`.
 * - Objects are parsed leniently: unknown keys are dropped, and an unknown enum value from a newer server falls back
 *   to a neutral value instead of rejecting the whole response.
 * - Every object that can be acted upon lists the actions the server authorises in `allowedActions`.
 * - No field holds a token, a key or a secret, except the token `POST /auth/login` mints once.
 *
 * Responses are validated with these schemas at the boundary (`src/api/http.ts`), so a server that drifts from the
 * contract produces a clear `invalid_response` error instead of a crash deep inside a screen.
 */
export * from '@opswatch/contract';
