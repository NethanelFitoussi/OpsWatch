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

The `/api/v1` contract is shared by the server, the web app and mobile. It lives in `packages/contract`, owned jointly
with the server side — on their branch today, not on this one ([api-contract.md](api-contract.md)). The mobile side of
the move is already prepared:

| Step | State |
|------|-------|
| `src/api/contract.ts` free of React Native, Node and server-only imports (zod 4 only) | **Done**, and it is what makes the switchover a one-line re-export |
| Metro resolves a package outside `apps/mobile` | **Done**: `metro.config.js` adds `../../packages/contract` to `watchFolders` when it exists, and pins `nodeModulesPaths` to this app's `node_modules` so the package's `zod` import resolves |
| Jest resolves the same thing | **Done**: `moduleNameMapper` maps `^zod$` to this app's copy, and `zod` is in `transformIgnorePatterns`'s exception list |
| A parity check between the two copies | **Done**: `src/api/__tests__/contract-parity.test.ts`, skipped until the package is present, and runnable against another checkout with `OPSWATCH_CONTRACT_DIR` |
| TypeScript `paths` entry | **Not needed** for a relative re-export; add one only if the package is imported by name |
| The CI path filter includes `packages/contract/**` | **To do** when the package lands: `.github/workflows/mobile.yml` currently watches `apps/mobile/**`, `docs/mobile/**` and itself |

**Switchover, when `packages/contract` is on this branch:** replace the body of `apps/mobile/src/api/contract.ts` with

```ts
export * from '../../../../packages/contract';
```

run `npm run check` (the parity suite stops skipping and runs from then on), then delete the local schemas. Restart
Metro with `-c` so the new watch folder is picked up.

## CI

Two path-filtered workflows, both added on this branch:

| Workflow | What it does |
|----------|--------------|
| `.github/workflows/mobile.yml` | On pushes to `main` and pull requests touching `apps/mobile/**`, `docs/mobile/**` or the workflow: `npm ci`, lint, typecheck, `test:ci`, `npx expo config --type public`; then the web export plus the Playwright smoke tour |
| `.github/workflows/mobile-release.yml` | Manual only: `npm run check`, then an EAS build for a chosen platform and profile. It never submits, and holds no credentials beyond the `EXPO_TOKEN` secret |

The existing root `ci.yml` needs no change beyond not picking up `apps/` (handled by the exclusions above).

## Contract drift (checked 2026-09-20)

The server team adopted this app's contract as the canonical one and seeded `packages/contract` from it. Checked
against their work in progress with `OPSWATCH_CONTRACT_DIR`:

- **No drift.** Parity 65/65: every schema the app uses is exported by the package, and the package parses the app's
  demo data to a superset of the local copy.
- **One additive field**, `serverInfo.demo`, has been adopted here.
- The server's `/api/v1` envelope, error codes and status map match what the client already expects; the client now
  also honours `Retry-After` and refuses an answer from another origin.
- `GET /me` returns `id`, `role`, `locale` and `allowedActions`. The app keeps `email`/`name` and ignores the rest for
  now; adopting `meSchema` is part of the switchover.
- Open requests are listed in [api-contract.md](api-contract.md#contract-gaps--requests). None block the merge.

## Verified before merging

- `npm run check` in `apps/mobile`: lint and typecheck clean, **1176 tests passing in 55 suites**, plus the 66-test
  contract parity suite skipped because `packages/contract` is not on this branch.
- **Parity, run for real: 66/66** against `packages/contract` on the server team's `feature/opswatch-intelligence` at
  `3881b23`, including the ten additive fields they landed in `089808a`. Their notes record this gate as blocked by a
  compilation error in this branch's `jest.setup.ts`; that is fixed, and the gate is green. Re-run it with:

  ```bash
  OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest parity
  ```
- `expo-doctor`: 21/21.
- The web export tour at six device profiles (36/36), and a native Android release build run on an Android 15
  emulator ([testing.md](testing.md#what-has-actually-been-verified)).
- **iOS has never been run.** Nothing about the merge changes that; see [ios.md](ios.md).
- Nothing outside `apps/mobile`, `docs/mobile`, `.github/workflows/mobile*.yml` and the four root exclusions was
  touched on this branch, so the web app's own suite is unaffected.
