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

## Contract drift

To be filled at the final sync: every difference found between `apps/mobile/src/api/contract.ts` and
`packages/contract` (field, endpoint, enum value), and how it was resolved.

| Area | Difference | Resolution |
|------|-----------|-----------|
| | | |
