# Contributing to OpsWatch

Thanks for helping. Bug reports, translations, documentation and code are all welcome.

## Setup

Requirements: Node.js 22.12 or later (see `.nvmrc`), npm, Docker.

```bash
npm ci
cp .env.example .env.local
# Set OPSWATCH_SECRET in .env.local to at least 32 random characters,
# and OPSWATCH_DATA_DIR to a local folder such as ./data
npm run dev
```

The app runs on http://localhost:3000.

## Tests

| Command | What it runs |
|---------|--------------|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` | Unit tests (Vitest). AWS calls are mocked with `aws-sdk-client-mock` |
| `npm run lint:template` | Generates a sample CloudFormation template and checks it with `cfn-lint` (needs Docker) |
| `npm run e2e` | Playwright against the test stack, see below |

End-to-end tests run against the Docker image, with AWS replaced by a local moto server:

```bash
docker compose -f docker-compose.test.yml up -d --build --wait
npx playwright install chromium
npm run e2e
docker compose -f docker-compose.test.yml down -v
```

Start from a fresh stack each time: the suite creates the admin account.

## Conventions

- Write the failing test first, then the code.
- Every user-visible text lives in `messages/en.json` and `messages/fr.json`. A unit test
  fails if the two files do not have the same keys.
- Any new AWS call needs its IAM action added to `src/lib/aws/actions.ts`. That catalogue
  feeds both the generated template and the guide, so they never drift apart. Adding an
  action requires bumping `TEMPLATE_VERSION`.
- OpsWatch only reads. Pull requests that add write actions on customer accounts are declined.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `refactor:`, `chore:`.
- Keep pull requests focused on one change and fill in the template.

## Reporting security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
