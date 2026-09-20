# Merge notes: `feature/mobile` with the web/API work

What to know when `feature/mobile` meets the branches carrying the web app and the `/api/v1` server work.

## Root exclusions (already on `feature/mobile`)

The mobile app has its own toolchain (Expo, Jest, its own ESLint and TypeScript config and lockfile). Four one-line
exclusions keep the web tooling away from `apps/`:

| File | Line | Why |
|------|------|-----|
| `tsconfig.json` | `"exclude": ["node_modules", "apps"]` | The web `tsconfig` includes `**/*.ts`; React Native types would break the web typecheck |
| `eslint.config.mjs` | `"apps/**"` in the global ignores | The web ESLint lints `.` |
| `knip.json` | `"apps/**"` in `ignore` | Mobile dependencies are not in the root `package.json` |
| `.dockerignore` | `apps` | Keeps the mobile app out of the server image build context |

On conflict, keep the other side's changes and re-add these lines.

## No root `package.json` change

`apps/mobile` is a standalone npm project with its own `package.json` and `package-lock.json`. There is no workspace
migration and no root script for mobile. The root `npm ci`, `npm run dev`, Docker build and Vitest run are unaffected.

## `packages/contract`

The `/api/v1` contract is shared by the server, the web app and mobile. It moves to `packages/contract`, owned jointly
with the server side ([api-contract.md](api-contract.md)). Plan on the mobile side once the package is on this branch:

1. Delete `apps/mobile/src/api/contract.ts` and import from the package.
2. Metro: add the package folder to `watchFolders` in `apps/mobile/metro.config.js` (to be created) and resolve it,
   for example through `resolver.extraNodeModules` or a local `file:` dependency, so Metro bundles a file outside
   `apps/mobile`.
3. Jest: add a `moduleNameMapper` entry in `apps/mobile/jest.config.js` pointing the package name at its source, and
   make sure it is transformed (not excluded by `transformIgnorePatterns`).
4. TypeScript: add a `paths` entry in `apps/mobile/tsconfig.json`.
5. The package must stay free of React Native, Node and server-only imports (zod 4 only), as the local copy is today.

## CI

Mobile CI is a separate, path-filtered workflow: `.github/workflows/mobile.yml` (being added), triggered only by
changes under `apps/mobile/**` and `docs/mobile/**` (and `packages/contract/**` once it exists). It runs from
`apps/mobile`: `npm ci`, lint, typecheck, tests and the web export smoke. The existing root `ci.yml` does not need
changes beyond not picking up `apps/` (handled by the exclusions above).

## Contract drift (checked 2026-09-20)

The server team adopted this app's contract as the canonical one and seeded `packages/contract` from it. Checked
against their work in progress:

- **No drift.** Parity 65/65: every schema the app uses is exported by the package, and the package parses the app's
  demo data to a superset of the local copy.
- **One additive field**, `serverInfo.demo`, has been adopted here.
- The server's `/api/v1` envelope, error codes and status map match what the client already expects; the client now
  also honours `Retry-After`.
- `GET /me` returns `id`, `role`, `locale` and `allowedActions`. The app keeps `email`/`name` and ignores the rest for
  now; adopting `meSchema` is part of the switchover.
- Open requests are listed in [api-contract.md](api-contract.md#contract-gaps--requests). None block the merge.

**Switchover, when `packages/contract` is on `main`:** replace the body of `apps/mobile/src/api/contract.ts` with
`export * from '../../../../packages/contract';`, run `npm run check`, then delete the local schemas. Metro already
watches the folder (`apps/mobile/metro.config.js`), so no npm workspace and no root `package.json` change is needed.
The parity suite stops skipping and runs in CI from then on.

## Verified before merging

- `npm run check` in `apps/mobile` (lint, typecheck, 976 tests in 42 suites).
- The web export tour at six device profiles, and a native Android release build run on an emulator
  ([testing.md](testing.md#what-has-actually-been-verified)).
- Nothing outside `apps/mobile`, `docs/mobile`, `.github/workflows/mobile*.yml` and the four root exclusions was
  touched on this branch, so the web app's own suite is unaffected.
