# OpsWatch Stage 4 — Multi-provider connections, with Cloudflare as the second provider

Status: design, 2026-09-18, branch `feat/step-1-foundations`. Owner request, in their words: "Pouvoir se connecter à Cloudflare. Le premier pas doit être décomposé maintenant: à l'intérieur quand tu cliques tu vois un bouton Google, un bouton AWS, un bouton Cloudflare, un bouton Slack…" They also showed Datadog's Cloudflare Zero Trust dashboard: KPI tiles, time series, top IPs, top devices, top identities, filters by zone and by user.

Stage 1 built the connection model, the permission test and the getting-started guide for AWS. Stages 2 and 3 built the live pages and the analysis layer on top of them. This stage does two things and stops: it turns the AWS-only connection into a provider-typed connection, and it makes Cloudflare a real, connectable provider with its own token flow, its own capability test and its own guide section. It builds no Cloudflare data page; §8 scopes those for the next stage.

Every Cloudflare fact below carries the official page it came from. Where a page could not confirm a detail, it is marked *not verified* in place and repeated in §11, which is the single list the owner should read before trusting the guide.

## 1. Scope

In scope:
1. A `provider` on every connection, with `aws` and `cloudflare` connectable and `gcp` and `slack` declared but not connectable.
2. The migration that adds it, keeping every existing AWS connection working with no user action.
3. The "Add an account" flow opening on provider cards.
4. A Cloudflare connection: one API token, encrypted at rest, plus the account and zones it can see.
5. A Cloudflare capability test, the equivalent of the AWS permission test: one cheap read per capability, each mapped to a Cloudflare permission group, each reported as allowed, missing or error.
6. A Cloudflare section in the getting-started guide, in the style of the AWS one.
7. The test harness: a local fake of the Cloudflare API, the moto equivalent.

Out of scope, on purpose: every Cloudflare data page (§8 names them and the API each needs), Google Cloud, Slack, and any write call to any provider, ever.

## 2. Provider model

### 2.1 Providers

`src/lib/connections/providers.ts` is the single source, as `src/lib/aws/actions.ts` is for IAM actions:

| id | state | what it is |
|----|-------|-----------|
| `aws` | connectable | the Stage 1 connection, unchanged |
| `cloudflare` | connectable | one scoped API token |
| `gcp` | declared | a read-only service account for Cloud Monitoring and Cloud Logging |
| `slack` | declared | a bot token to read channel and delivery health, and later to send alerts |

A declared provider has an id, a title, a one-sentence description and no code path. It appears on the picker and nowhere else. Adding the fifth provider means adding a row here, a `src/lib/<provider>/` module and a guide section — nothing in the shared code.

### 2.2 Methods

`method` stays the column it is, and becomes provider-scoped:

- `aws`: `role` | `ambient` | `keys` (unchanged)
- `cloudflare`: `token` (the only one; Cloudflare has no assumable role and no ambient identity)

`CONNECTION_METHODS` becomes the union of both lists, so the column enum still accepts every stored value. `methodSchema` becomes `methodSchema(provider)` and rejects a method that does not belong to the provider.

### 2.3 Status and the permission test, generalised

The three statuses `ok`, `degraded`, `failed` and the three draft states keep their meaning: `ok` means every capability the provider offers is readable, `degraded` means the connection authenticates but at least one capability is denied, `failed` means it does not authenticate or nothing at all is readable. `overallStatus()` in `src/lib/aws/permissions.ts` is already provider-agnostic arithmetic; it moves to `src/lib/connections/permissions.ts` unchanged.

The result shape is renamed away from AWS vocabulary, and versioned:

```ts
type CapabilityCheck = {
  capability: string;    // 'ecs' | 'logs' | … | 'zoneAnalytics' | 'securityEvents' | …
  scope: string;         // AWS: a region. Cloudflare: 'account' or 'zone:<id>'
  permission: string;    // AWS: 'ecs:ListClusters'. Cloudflare: 'Account Analytics: Read'
  status: 'ok' | 'denied' | 'error' | 'not_applicable';
  errorCode?: string;
  checkedAt: string;
};

type PermissionTestResult = {
  version: 2;
  overall: 'ok' | 'degraded' | 'failed';
  identityOk: boolean;      // was accountMatches
  identityLabel?: string;   // AWS: the caller ARN. Cloudflare: the token id and account name
  identityError?: string;
  checks: CapabilityCheck[];
  testedAt: string;
};
```

`region` becomes `scope`, `action` becomes `permission`, `service` becomes `capability`. Nothing else moves. A stored result with no `version` is a Stage 1 result: `upgradeTestResult()` maps `service`→`capability`, `region`→`scope`, `action`→`permission`, `accountMatches`→`identityOk`, `identityArn`→`identityLabel`, so **an existing AWS connection renders its last checklist exactly as before without re-running the test**. The upgrade happens on read, never on write; the row is rewritten in the new shape the next time the test runs.

The checklist component groups by `scope` instead of by region and looks its labels up per provider, so the AWS wording (`Services.ecs`, `Checklist.impact.ecs`) is untouched and Cloudflare adds its own keys.

### 2.4 Module layout

```
src/lib/connections/
  providers.ts        the provider catalogue (§2.1)
  types.ts            provider, method and status unions
  permissions.ts      overallStatus, the shared check types, upgradeTestResult
  repository.ts       provider-agnostic CRUD, provider-specific setters
  test-connection.ts  dispatches on row.provider
  validation/aws.ts, validation/cloudflare.ts
src/lib/cloudflare/
  api.ts              read-only fetch wrapper: base URL, bearer auth, timeout
  graphql.ts          one POST /graphql helper
  errors.ts           Cloudflare error → denied | throttled | error
  capabilities.ts     the capability catalogue (Cloudflare's src/lib/aws/actions.ts)
  permissions.ts      runCloudflareCapabilityTest
```

Every file in `src/lib/cloudflare/` starts with `import 'server-only'`. No Cloudflare SDK is added: the official `cloudflare` npm package (7.1.0, Apache-2.0) documents no GraphQL Analytics support and no base-URL override, and the GraphQL Analytics API is where most of the data lives. A plain `fetch` wrapper is also what makes the base-URL override of §9 a one-line thing. The wrapper exposes `get` and `graphql` and nothing else (§10).

## 3. Data model and migration

`connections` gains three columns and loses two NOT NULL constraints:

| Column | Change |
|--------|--------|
| `provider` | new, `text NOT NULL DEFAULT 'aws'` |
| `provider_config_ciphertext` | new, `text` — AES-256-GCM, the provider's whole configuration including its secret |
| `aws_account_id` | becomes nullable (a Cloudflare row has no AWS account) |
| `regions` | becomes nullable (a Cloudflare row has no region) |
| everything else | unchanged |

SQLite cannot relax a NOT NULL in place, so `drizzle/0001_*.sql` is the recreate-copy-drop-rename that `drizzle-kit generate` emits for this change, copying every existing row with `provider = 'aws'`. `migrate()` already runs at startup in `src/lib/db/client.ts`, so the owner does nothing. The alternative — keeping the constraints and writing `''` and `'[]'` into a Cloudflare row — was rejected: a sentinel that means "not applicable" is a bug waiting for the first `WHERE aws_account_id = ?`.

`access_key_ciphertext` is deliberately left alone. AWS keys keep their HKDF purpose `'access-keys'`, so no existing ciphertext is re-encrypted and no migration can lose an AWS key. `crypto.ts` gains one purpose, `'provider-config'`, for the new column.

For Cloudflare the plaintext of `provider_config_ciphertext` is:

```json
{
  "token": "<the API token>",
  "tokenId": "ed17574386854bf78a67040be0a770b0",
  "accountId": "<account tag>",
  "accountName": "Acme",
  "zones": [{ "id": "<zone tag>", "name": "acme.com" }]
}
```

`accountName` and `zones` are filled by the capability test and refreshed on every run; the user never types them. The whole blob is encrypted, not just the token, because the zone list and the account name name the owner's infrastructure and there is no reason for them to sit in clear in a file that gets copied around in backups.

`ConnectionView` — what a page is allowed to see — gains `provider` and, for Cloudflare, `tokenId`, `accountId`, `accountName`, `zones` and `configUnreadable`. It never carries `token`. The existing `keysUnreadable` behaviour is reused: a blob that does not decrypt (changed `OPSWATCH_SECRET`, tampered file) marks the connection unreadable with an explicit message rather than crashing the page.

## 4. The provider picker

`/accounts/new` stops being the AWS wizard and becomes the picker. The wizards move down one segment:

- `/[locale]/accounts/new` — four provider cards
- `/[locale]/accounts/new/aws` — the Stage 1 wizard, moved verbatim, with `provider=aws` as a hidden field
- `/[locale]/accounts/new/cloudflare` — the token form of §5
- any other segment — 404

Nothing else in the URL structure changes: `/accounts`, `/accounts/[id]`, and the API routes stay where they are, and `createConnectionAction` gains a provider argument and still redirects to `/accounts/<id>`.

The cards: AWS and Cloudflare are links with a short description. Google Cloud and Slack are static cards, visibly muted, with a "Coming soon" badge and one sentence each — "Read Cloud Monitoring metrics and Cloud Logging entries from a read-only service account" and "Watch delivery and channel health from a read-only bot token". They are not links and not disabled buttons, so nothing focusable lies about being actionable.

The page title becomes `Wizard.pickerTitle` ("Add an account"), and each wizard keeps a provider title (`Wizard.providers.aws.wizardTitle` = "Add an AWS account", the existing string). New keys live under `Wizard.providers.<id>.{title,description,soon}`, in both catalogues.

## 5. Connecting Cloudflare

### 5.1 The token model

Two credentials can authenticate a call to the Cloudflare REST API. The **Global API Key** is sent as `X-Auth-Email` plus `X-Auth-Key`, authenticates as the whole user and cannot be scoped; the API reference itself says "When possible, use API tokens instead of Global API keys" ([List Accounts](https://developers.cloudflare.com/api/resources/accounts/methods/list/)). An **API token** is sent as `Authorization: Bearer <token>`, is limited to the permission groups ticked when it was created, to the accounts and zones selected, and optionally to a set of client IPs and a TTL ([Create an API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)).

**OpsWatch accepts API tokens only.** There is no field for a Global API Key, and the `X-Auth-Email` / `X-Auth-Key` headers are never sent by any code path.

Tokens come in two ownerships: *user* tokens, created under My Profile, and *account-owned* tokens, which "allow you to set up durable integrations that can act as service principals with their own specific set of permissions", while a user token "acts on behalf of a particular user and inherits a subset of that user's permissions" ([Account-owned tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). The quotas differ — 50 user tokens, 500 account tokens ([Limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/)). OpsWatch recommends an account-owned token, because a user token dies with the person who made it; the guide also has to say that **creating one requires the Super Administrator role**, which is stated on that same page.

Two optional restrictions matter to OpsWatch ([Restrict API tokens](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/)):

- **TTL** sets `not_before` and `expires_on`; the dashboard's date pickers resolve to 00:00 UTC.
- **Client IP Address Filtering** takes *Is in* / *Is not in* rules in CIDR notation, and defaults to all IPs allowed.

And one trap that shapes §6: **IP restrictions are not applied to the Verify Token endpoint.** A token restricted to the wrong IP therefore *verifies successfully* and then fails every real call. The capability test must never conclude from a good verify that the network path is fine, and the troubleshooting list says so explicitly.

### 5.2 Verifying a token

`GET /client/v4/user/tokens/verify` returns `{ success, result: { id, status, expires_on, not_before }, errors, messages }`, where `status` is `"active"`, `"disabled"` or `"expired"` ([Verify Token](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/)). An account-scoped equivalent exists with the same shape: `GET /client/v4/accounts/{account_id}/tokens/verify` ([Verify Token, account](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/)).

OpsWatch's order: call the user endpoint; if it fails and the user supplied an account id, call the account endpoint. That order is deliberate rather than arbitrary — **whether `/user/tokens/verify` accepts an account-owned token is not documented either way**, so the fallback is what makes an account-owned token work without asking the user which kind they made. Whichever answers gives the `tokenId` stored in §3 and the identity result of the checklist. A `status` other than `"active"` is an identity failure (`TokenExpired`, `TokenDisabled`), not a permission failure — the distinction matters because the user's fix is different.

The error envelope is the same on every REST endpoint: `errors: [{ code, message, documentation_url, source }]`. One numeric code is documented: a permission failure is **HTTP 403 with `code: 10000`**, and since 20 August 2026 the error object also carries a `documentation_url` pointing at the endpoint's reference page so the caller can look up the accepted permissions ([Contextual 403s](https://developers.cloudflare.com/changelog/post/2026-08-20-contextual-403s/)). The codes for an invalid, disabled or expired *token* are *not verified* — no official page enumerates them, and the 6003 and 9109 codes that circulate are community-sourced only. OpsWatch therefore classifies on the HTTP status first and stores the numeric code only as a hint (`cf:10000`).

### 5.3 Finding the accounts and zones

- `GET /client/v4/zones` — path and permission confirmed: it accepts `Zone Zone Read` ([List Zones](https://developers.cloudflare.com/api/resources/zones/methods/list/)). This is how OpsWatch learns the zone list, and it is the reason `Zone: Zone Read` is on the ticket list even though the analytics queries do not need it.
- `GET /client/v4/accounts` — *not verified*: the reference page for List Accounts documents only the Global API Key scheme and lists no token permission. OpsWatch treats it as best effort. The wizard therefore asks for the account id as an optional field, and the checklist reports the account listing as `not_applicable` with an explicit note when the user supplied the id themselves. Nothing downstream depends on the listing succeeding.

### 5.4 The minimum read-only permissions

Confirmed permission group names and scopes, from [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) unless stated otherwise:

| What it unlocks | Permission group | Scope | Source |
|---|---|---|---|
| Zone traffic, cache and status-code analytics (`httpRequestsAdaptiveGroups`, `httpRequests1hGroups`) | **Analytics: Read** — "Grants read access to analytics" | Zone | permissions reference |
| Security / firewall events (`firewallEventsAdaptive`) | **Analytics: Read** | Zone | confirmed indirectly: the [GraphQL errors page](https://developers.cloudflare.com/analytics/graphql-api/errors/) gives "verify the token has the Analytics: Read permission for the relevant resources" as the remedy for a 403, and uses a `firewallEventsAdaptiveGroups` path in its own example. No page names it for that dataset specifically. **Do not use *Firewall Services Read*** — that grants the firewall configuration API, not the analytics dataset |
| Zero Trust Gateway DNS, HTTP and network analytics (`gatewayResolverQueriesAdaptiveGroups`, `gatewayL7RequestsAdaptiveGroups`, `gatewayL4SessionsAdaptiveGroups`, `gatewayResolverByCategoryAdaptiveGroups`) | **Account Analytics: Read** | Account | [Gateway analytics](https://developers.cloudflare.com/cloudflare-one/insights/analytics/gateway/) names this permission explicitly |
| Zero Trust Access login events (`accessLoginRequestsAdaptiveGroups`) | **Account Analytics: Read** | Account | *not verified*: the [tutorial](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-access-login-events/) defers to the [analytics token page](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/), which documents only Account Analytics · Read |
| Access application names and policies | **Access: Apps and Policies Read** — "Grants read access to Cloudflare Access applications and policies". A narrower **Access: Apps Read** also exists | Account | permissions reference; which one the list endpoint accepts is *not verified* |
| Per-login Access audit log (`/accounts/{id}/access/logs/access_requests`) | **Access: Audit Logs Read** | Account | [Access authentication logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/audit-logs/): "At least one of the following token permissions is required: `Access: Audit Logs Read`" |
| Listing the zones the token can see | **Zone: Zone Read** | Zone | List Zones reference |

In the dashboard editor each row is three drop-downs. For the account analytics row that is *Account* → *Account Analytics* → *Read*, which the analytics authentication page states verbatim. Resource scoping uses the **Account Resources** and **Zone Resources** selectors on the same screen.

The minimum for a useful Cloudflare connection is therefore two rows — *Zone · Analytics · Read* and *Account · Account Analytics · Read* — plus *Zone · Zone · Read* so OpsWatch can name the zones. The two Access rows are optional and only the Zero Trust pages need them.

One more group exists and may turn out to be required: **Zero Trust: PII Read** — "Grants read access to Cloudflare Zero Trust PII". Nothing in the docs says whether a Gateway or Access dataset returns user emails and device names without it, and "top identities" is precisely a list of user emails. The guide lists it as an optional row with an honest caption ("tick this if the Zero Trust pages show ids instead of names"), and §11 records it as unverified.

### 5.5 What OpsWatch stores, and what it never stores

Stored, all inside the encrypted blob of §3: the token, the token id, the account id and name, and the zone ids and names. Stored outside it: the connection name, the provider, the status and the capability test result (capability names, permission names, statuses, error codes, timestamps).

The token is stored and nothing else: it is never logged and never sent back to the browser. The form field is write-only, like the AWS secret access key — after saving, the page shows the token id and nothing else, and there is no path that returns the token to a client component.

Never stored at all, and never logged: the Global API Key, the Cloudflare account email, any user name, device name or IP from a Zero Trust dataset, any Cloudflare error message text — only OpsWatch's own normalised code — and any analytics result, which is read live and never persisted, exactly as the AWS stages decided.

## 6. The Cloudflare capability test

The AWS test is `sts:GetCallerIdentity` then one cheap call per service per region. The Cloudflare test is the same shape: one identity call, then one cheap read per capability, each mapped to the permission group that grants it. Each call gets a 5 s timeout and they run in parallel, as `checkRegion()` already does.

| # | Capability | Call | Permission reported |
|---|---|---|---|
| 0 | identity | `GET /user/tokens/verify`, then the account variant | — |
| 1 | `zones` | `GET /zones?per_page=5` | Zone: Zone Read |
| 2 | `accounts` | `GET /accounts?per_page=5` | Account listing (best effort, §5.3) |
| 3 | `zoneAnalytics` | GraphQL `httpRequests1hGroups`, first zone, `limit: 1`, last hour | Zone: Analytics: Read |
| 4 | `securityEvents` | GraphQL `firewallEventsAdaptive`, first zone, `limit: 1`, last hour | Zone: Analytics: Read |
| 5 | `zeroTrustGateway` | GraphQL `gatewayResolverQueriesAdaptiveGroups`, account, `limit: 1`, last hour | Account: Account Analytics: Read |
| 6 | `zeroTrustAccess` | GraphQL `accessLoginRequestsAdaptiveGroups`, account, `limit: 1`, last hour | Account: Account Analytics: Read |
| 7 | `accessApps` | `GET /accounts/{id}/access/apps?per_page=1` | Account: Access: Apps and Policies Read |

Plus one non-check that rides along: the same GraphQL document asks the **`settings` node** for each dataset it touched. That node returns `notOlderThan` (how far back this plan can read, in seconds), `maxDuration` (the widest window a single query may ask for), `maxNumberOfFields` and `maxPageSize` ([Settings node](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/)) — the documented example for `firewallEventsAdaptive` is `{"enabled": true, "maxDuration": 259200, "maxNumberOfFields": 30, "maxPageSize": 10000, "notOlderThan": 2678400}`. OpsWatch stores those numbers in the config blob and the next stage's time-range picker reads them, so **retention and window limits are discovered at runtime instead of hardcoded from a per-plan table**. A table in a spec goes stale; this node does not.

Rules:
- Checks 3 and 4 are `not_applicable` when the token sees no zone; 5, 6 and 7 are `not_applicable` when no account id is known.
- A verified token is never taken as proof that the network path works, because Cloudflare does not apply a token's IP restrictions to the verify endpoint (§5.1). When identity succeeds and *every* other check fails, the checklist says so and names the IP filter as the first thing to look at.
- Checks 4, 5 and 6 are separate even though 5 and 6 share a permission, because a token can hold the permission and still get nothing back: the dataset may not exist on the plan. That case is `not_applicable` with its own note, never `denied` — telling a user to tick a permission they already ticked is the worst outcome of a permission test.
- The queries ask for `limit: 1` over the last hour, so the cost is a rounding error against the budget of §10, and they select only `count` — no dimension, so no customer data is fetched by the test.

### 6.1 Error classification

REST ([error envelope](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/)):

| Signal | Result |
|---|---|
| HTTP 401 | identity error (`TokenInvalid`) |
| HTTP 403 (documented as `code: 10000`) | `denied` |
| HTTP 429 | `throttled` |
| our own abort | `error`, code `Timeout` |
| anything else | `error` |

GraphQL is different and the difference is load-bearing. The [errors page](https://developers.cloudflare.com/analytics/graphql-api/errors/) states that a `200` response can still carry errors, that `errors` is `null` when there are none and otherwise an array of objects with `message`, `path` and `extensions.timestamp`, and that **there is no numeric code anywhere in a GraphQL error**. The documented categories are: 401 `"Unauthorized"`; 403 `"not authorized for that account"`, `"zones [...] are not authorized"`, `"does not have access to the path..."`; 400 for dataset limits (`"cannot request data older than..."`, `"limit must be positive number and not greater than..."`) and parse errors; 429 `"rate limiter budget depleted, try again after 5 minutes"` and `"query consumed excessive resources, please try running smaller queries"`; 503 `"too many queries in progress, please try again later"`; 500 `"Internal server error"`. So:

- a non-empty `errors` array is always a failure, whatever the HTTP status — the status alone is never trusted;
- 401 with `Unauthorized` → identity error;
- a message containing `not authorized`, `are not authorized` or `does not have access to the path` → `denied`;
- a message containing `cannot request data older than` or `limit must be positive` → `error`, code `RangeTooLong` (a window bug or a plan retention limit, not a permission — and the `settings` node above is how the next stage stops producing them);
- 429, or a message containing `rate limiter budget depleted` or `consumed excessive resources` → `throttled`;
- 503 → `error`, code `Unavailable`;
- anything unrecognised → `error` with code `GraphQlError`, never `ok` and never `denied`.

The `path` array names the failing node and, for a zone-scoped query, the index of the zone that failed — so a query over several zones reports per-zone denials instead of one flat failure. That index is used to attribute the check to the right zone scope, and nothing else from the error is kept.

The message text is used to classify and then dropped; only OpsWatch's own code reaches the database and the logs, because Cloudflare's messages embed zone and account identifiers.

### 6.2 What the user sees

The existing checklist, grouped by scope instead of by region: one group for the account, one per zone. Each row is the capability name, the permission group as written in the dashboard, and the status. A denied row says exactly which drop-down triple to tick and what the user loses: "Missing *Account · Account Analytics · Read*. The Zero Trust pages will be empty." A `not_applicable` row says why: no zone on this token, or the dataset is not available on this plan.

## 7. The getting-started guide

The guide's "Step by step" section gains a provider layer. The three AWS methods stay exactly as they are, under an AWS tab; a Cloudflare tab sits beside it. Everything else on the page (the diagram, the security section, the troubleshooting list) grows a Cloudflare block rather than being duplicated.

Cloudflare sub-steps, in the numbered style of `role-steps.tsx`, with the exact click path:

1. **Choose who owns the token.** In the Cloudflare dashboard, open **Manage Account** → **API Tokens** for an account-owned token, or **My Profile** → **API Tokens** for a personal one. Prefer the account-owned token: a personal one stops working when its owner leaves. *(The [create-token page](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) gives these two paths; the [analytics token page](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/) calls the same screen the "Account API tokens" page. The guide gives both wordings and the owner confirms the live label — see §11.)*
2. **Create a custom token.** Select **Create Token**, then **Get started** in the **Custom token** section. Name it `opswatch-readonly`.
3. **Tick the permissions.** Each row is three drop-downs. Add, in order: *Account* · *Account Analytics* · *Read*; *Zone* · *Analytics* · *Read*; *Zone* · *Zone* · *Read*. Then, only if you want the Zero Trust detail pages: *Account* · *Access: Apps and Policies* · *Read*, *Account* · *Access: Audit Logs* · *Read*, and *Account* · *Zero Trust: PII* · *Read* if you want user names rather than ids. Every row says **Read** — there is no **Edit** row on this token, and OpsWatch would not be able to use one.
4. **Scope the resources.** Under **Account Resources**, choose **Include** and your account. Under **Zone Resources**, choose **Include** → **All zones from an account**, or name the zones you want OpsWatch to read.
5. **Optional: narrow it further.** **Client IP Address Filtering** restricts the token to the public IP your OpsWatch instance calls from, as an *Is in* rule in CIDR notation; **TTL** gives it a start and an expiry date. Both are good ideas. Two warnings the guide must carry: if you set a TTL the connection stops working on that date and the test will say `expired`, not `denied`; and if you set an IP filter from the wrong address, the token still *verifies* — Cloudflare does not apply IP restrictions to the verify endpoint — so the test will show a good identity and a wall of denials.
6. **Create and copy.** Select **Continue to summary**, check the list, then **Create Token**. The token is shown once. Copy it now.
7. **Paste it into OpsWatch.** **Accounts** → **Add** → **Cloudflare**, paste the token, optionally paste the account id, **Create connection**, then **Run test** and read the checklist.

Illustrated mock screen, built from the existing `MockWindow` / `MockPanel` primitives: breadcrumb *Cloudflare › Manage Account › API Tokens*, title *Create Custom Token*, a **Permissions** panel with the three-drop-down rows of step 3, a **Zone Resources** row, and a footer with *Continue to summary*. As with the AWS mocks it is `aria-hidden` and the caption carries the meaning, so it can never become the only source of a step. Every label is a message key under `GettingStarted.mockups.cloudflare.*`.

**"Why not my Global API Key?"** — a callout, in the voice of the existing ExternalId explanation. Your Global API Key is your password for the whole of Cloudflare: it authenticates as you, on every account and every zone you can reach, for reading *and* writing — DNS records, firewall rules, billing. It cannot be scoped to a permission, to a zone, to an IP or to a date, and rolling it breaks every other tool that uses it. A token is the opposite: it carries only the rows you ticked, only on the resources you selected, optionally only from your IP and only until its expiry, and you can delete this one without touching anything else. That is why OpsWatch has a field for a token and no field for a key.

The troubleshooting list gains six Cloudflare entries: the token verifies but every analytics check is denied (the permission was added at the wrong scope — *Account Analytics* is not the same row as *Analytics*); the token verifies but *everything* is denied (the Client IP filter does not include the address your instance calls from, and the verify endpoint ignores that filter, so it told you nothing); the zone list is empty (Zone Resources was left empty, or the token is account-scoped only); a check is `not_applicable` although the permission is ticked (the dataset is not on your plan — §8); the Zero Trust pages show ids instead of names (*Zero Trust: PII Read*, §5.4); `expired` (the TTL passed, create a new token). A seventh covers creation itself: **Create Token** is missing on the account screen when you are not a Super Administrator.

## 8. What comes next, scoped but not built now

Three pages, in this order, each with the API it needs. None of them is built in this stage.

1. **Zone traffic and cache** — per zone: requests, bytes, cached share, status-code mix, top paths and countries, over the standard time range. GraphQL Analytics API, `viewer > zones > httpRequestsAdaptiveGroups` for short windows and `httpRequests1hGroups` for long ones ([GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)). **No extra permission** beyond *Zone · Analytics · Read*.
2. **Security events** — events by action, by rule, by source IP, by country, plus the KPI row. GraphQL, `firewallEventsAdaptive` (raw) and `firewallEventsAdaptiveGroups` (aggregated) ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)). **No extra permission.** Retention is the hard wall and the page must say so.
3. **Zero Trust sessions and top identities** — the Datadog screen the owner showed. GraphQL on the account: `gatewayResolverQueriesAdaptiveGroups` (DNS), `gatewayL7RequestsAdaptiveGroups` (HTTP), `gatewayL4SessionsAdaptiveGroups` (network sessions), `gatewayResolverByCategoryAdaptiveGroups` (categories), and `accessLoginRequestsAdaptiveGroups` (logins, which is where "top identities" comes from; its events start no earlier than **16 September 2022**, per the tutorial). **No extra permission** beyond *Account · Account Analytics · Read* — **but** three additions do: naming applications instead of showing ids needs *Access: Apps and Policies Read* (REST, `/accounts/{id}/access/apps`); the per-login detail list needs *Access: Audit Logs Read* (REST, `/accounts/{account_id}/access/logs/access_requests`); and showing user emails and device names rather than ids may need *Zero Trust: PII Read* (§5.4, unverified). All three are optional and their absence degrades the page rather than emptying it.
   One nuance that will otherwise look like a bug: the REST Access log covers **identity-based** authentication events only, and the [docs](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/logs/subresources/access_requests/methods/list/) say to use the GraphQL Analytics API for **non-identity** events. Full coverage needs both, and the page has to say which source a row came from.

Three shared decisions the next stage inherits:

- **Limits are discovered, not hardcoded.** Every page reads `notOlderThan` and `maxDuration` from the `settings` node (§6) for the datasets it uses, and the time-range picker greys out what the plan cannot answer. The published per-plan tables are documentation for the guide, not logic: `firewallEventsAdaptive` retains 24 h on Free and Pro, 3 days on Business, 30 days on Enterprise, with a maximum single-query window of 24 h / 24 h / 3 days / 31 days; `httpRequestsAdaptive*` retains 7 / 7 / 31 / 90 days with a window of 24 h / 7 days / 31 days / 31 days ([Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)). Retention for `httpRequests1hGroups` is published nowhere — another reason the node wins.
- **Adaptive datasets return estimates, and the pages say so.** Every dataset with `Adaptive` in its name is adaptively sampled: no sampling at low volume, progressively lower rates as volume grows, and the rate cannot be controlled ([Sampling](https://developers.cloudflare.com/analytics/graphql-api/sampling/)). A real count is the sampled count multiplied by the inverse of the rate — Cloudflare's own example is 5,000 sampled events at a 10 % rate estimating 50,000. Any KPI tile built on one of these carries an "estimated" marker.
- **GraphQL versus REST.** Everything that is a time series or a top-N is GraphQL; everything that is an object list (zones, accounts, Access applications, Gateway rules and configuration) is REST. There is no third path.
- **The URL scheme generalises, it does not fork.** `/c/<connectionId>/<region>/<section>` becomes `/c/<connectionId>/<scope>/<section>`, where the scope segment is an AWS region for an AWS connection and a zone id — or the literal `account` for account-wide pages — for a Cloudflare one. `parseMonitoringPath`, `monitoringPath` and the connection switcher keep working and every existing AWS URL stays valid. The region picker becomes a scope picker that renders zones for a Cloudflare connection. The sidebar shows the sections of the connection's provider, and the Stage 3 section panel, filter row, KPI tiles, top-N bars and facets are reused as they are — the Datadog screen the owner showed is exactly that vocabulary.

## 9. Testing

### 9.1 A local fake of the Cloudflare API

`OPSWATCH_CLOUDFLARE_API_URL` (default `https://api.cloudflare.com/client/v4`) points every Cloudflare call at a base URL, exactly as `OPSWATCH_AWS_ENDPOINT_URL` points every AWS client at moto. `.env.example` documents it with the same warning: tests only, never set it in production.

The fake is `tests/e2e/stub/cloudflare/server.mjs`, a single Node HTTP file with no dependency, mounted read-only and run by the stock Node image beside moto:

```yaml
  cloudflare:
    image: node:22-alpine
    working_dir: /stub
    volumes: [./tests/e2e/stub/cloudflare:/stub:ro]
    command: node server.mjs
    ports: ["5056:5000"]
```

with `OPSWATCH_CLOUDFLARE_API_URL: http://cloudflare:5000/client/v4` on the `opswatch` service. It implements `GET /user/tokens/verify`, `GET /accounts/{id}/tokens/verify`, `GET /zones`, `GET /accounts`, `GET /accounts/{id}/access/apps` and `POST /graphql`, and it is stateless: the behaviour is selected by the bearer token itself, so one running stub covers every case and no seeding step is needed.

| Token | Behaviour |
|---|---|
| `e2e-full` | everything allowed; GraphQL returns a fixed series for each dataset |
| `e2e-partial` | zone reads allowed, account analytics answers 403 `"not authorized for that account"` → the checklist must read `degraded` |
| `e2e-nozones` | verify and accounts succeed, `GET /zones` returns an empty list → zone checks `not_applicable` |
| `e2e-expired` | verify returns `result.status: "expired"` |
| `e2e-invalid` | HTTP 401 with `errors: [{ code: 1000, message: "Invalid API Token" }]` |
| `e2e-throttled` | HTTP 429 with `retry-after: 30` |

The GraphQL responses carry the real envelope — `data`, and `errors` either `null` or an array of `{ message, path, extensions.timestamp }` — plus a `settings` node with plausible `notOlderThan` and `maxDuration` values, so the next stage's chart and time-range code has something correctly shaped to render. The stub deliberately does **not** invent a name for the per-record sampling multiplier: the field's identifier could not be confirmed on an official page (§11), so the first task of the next stage is to read it off a real response and then teach the stub.

### 9.2 Unit tests (Vitest, `fetch` mocked, no network)

- `api.ts`: the `Authorization: Bearer` header is present and the token appears nowhere else; the base URL is respected; the abort fires at the timeout; 401 → identity error, 403 → `denied`, 429 → `throttled`, 5xx → `error`.
- `graphql.ts`: HTTP 200 with a non-empty `errors` array is a failure; each of the four documented authorization messages maps to the right status; `cannot request data older than` maps to `RangeTooLong`; an unknown message maps to `error` and never to `ok`.
- `permissions.ts`: every check ok → `ok`; one denied → `degraded`; every check denied → `failed`; no zone → the zone checks are `not_applicable` and do not drag the overall status down; an expired token → `failed` with the identity error and no checks.
- `repository.ts`: provider dispatch; a Cloudflare row stores no `aws_account_id` and no `regions`; the blob round-trips; `toView` never returns `token`; a blob that does not decrypt yields `configUnreadable` instead of throwing.
- `upgradeTestResult`: a stored Stage 1 result renders with the same rows and the same labels as before.
- Redaction: a test that runs the whole capability test against a mocked failing API and asserts the token string appears in no `console.info` argument.
- Message parity between `en.json` and `fr.json` — the existing test covers the new keys automatically.
- Read-only: a test that reads `src/lib/cloudflare/api.ts` and fails if it contains `POST`, `PUT`, `PATCH` or `DELETE` other than the single GraphQL POST, and that the GraphQL helper rejects a document whose first token is not `query` or `{`.

### 9.3 End-to-end (Playwright, the existing Docker stack plus the stub)

- `/accounts/new` shows four cards; AWS and Cloudflare navigate, Google Cloud and Slack are marked coming soon and are not links.
- The AWS wizard still works from its new path, and specs 01 to 07 of Stages 1–3 pass unchanged — that is the regression proof that existing connections keep working.
- Creating a Cloudflare connection with `e2e-full`: the token field is empty after saving, the page shows the token id and the zone list, the test returns `ok` with every capability allowed.
- `e2e-partial` → `degraded`, with the Zero Trust rows denied and naming *Account · Account Analytics · Read*.
- `e2e-expired` → the identity error, not a permission error.
- `e2e-nozones` → the zone checks read "not applicable" with the empty-zone note.
- The token appears in no page source and in no network response body.

### 9.4 What only the owner can verify, with a real token

Everything in §11, plus: that a token created by following §7 word for word passes all seven checks; that the dashboard labels still read as the guide says; the real retention and sampling on the owner's plan; and whether the Zero Trust datasets return anything at all on their Zero Trust subscription.

## 10. Cost, limits and safety

Documented limits, from [Cloudflare API limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/): **1,200 requests per five minutes per user**, counted cumulatively across the dashboard, the Global API Key and tokens; 200 requests per second per IP on the client API; 50 user tokens and 500 account tokens. Exceeding the limit returns **HTTP 429** and blocks every API call for the following five minutes. Three response headers carry the state: `Ratelimit` (remaining quota and reset, e.g. `"default";r=50;t=30`), `Ratelimit-Policy` (quota and window), and `retry-after`, "the number of seconds, rounded up, until more capacity is available", sent only once the limit is exceeded.

GraphQL has its own budget, and the two official pages disagree: the limits table says "varies by query cost, max **320** per 5 min" while the [GraphQL limits page](https://developers.cloudflare.com/analytics/graphql-api/limits/) says **300 queries per 5-minute window**. **OpsWatch budgets against 300.** That page also sets the shape of a request: at most **10 zones per zone-scoped request**, exactly **one account** per account-scoped request, and the cost counted as *scopes × nodes* — so a document asking 4 datasets across 10 zones spends 40 of the 300, not 1.

Against that budget:

- **The capability test costs at most 8 requests** — 1 verify, 3 REST, 4 GraphQL — each scoped to one zone and one account and each asking `limit: 1`. Under the *scopes × nodes* rule that is well under 10 GraphQL queries. A user hammering the Run test button is the worst case and it is harmless.
- **A future page load is capped at 40 GraphQL queries in the scopes × nodes sense**, which is one page over at most 10 zones with 4 datasets, sent as 1 or 2 POSTs. A page that would exceed the cap narrows its zone selection first and says so, exactly as the Stage 3 reports state when a cap truncated their scope.
- **Caching** reuses the Stage 2 `TtlCache` unchanged: 60 s for analytics queries, 5 minutes for zone, account and application listings. The cache key includes the connection id, the scope and the query parameters, as `cacheKey` already builds it.
- **Timeouts**: 5 s for the capability test's cheap reads, 15 s for an analytics query, both with `AbortController`, as `sendWithTimeout` does for AWS.
- **No retries.** A 429 is surfaced as `throttled` with the `retry-after` value shown to the user, and the request is not repeated. An automatic retry loop is how one OpsWatch instance would spend the 1,200-per-five-minutes budget that every other tool on that account shares — and that budget is cumulative across the dashboard too, so a retry storm also locks the owner out of their own Cloudflare UI for five minutes.
- **Every call is read-only.** `src/lib/cloudflare/api.ts` exports `get` and `graphql` and nothing else; there is no code path that can issue a write verb, and §9.2 has the test that keeps it that way. The single POST OpsWatch makes is the GraphQL one, and the helper refuses a document that does not start with `query` or `{`, so a mutation cannot be sent even by accident.

Security constraints carried over from Stage 1 and applied here:

- No user-facing string in code; every new string is a key in both `messages/en.json` and `messages/fr.json`, and the parity test enforces it.
- Every Cloudflare call runs server-side. The token is decrypted at call time into a local variable, never serialised into a server component's props, never put in a URL or a query string, never written to a log line. `logConnectionEvent` gains a `capability_test` event carrying the connection id, the provider, a boolean and an error code — names and codes only, as the existing events do.
- This stage adds no API route: the Cloudflare test reuses `POST /api/connections/[id]/test`. Any route added later does what that route does today and in that order — `isSameOrigin` against `OPSWATCH_PUBLIC_URL`, then `getCurrentAdminId`, and no database read and no provider call before both have passed.
- A connection whose blob does not decrypt is reported as such and never silently retried with a wrong key, mirroring the `SecretChanged` path of the AWS test.

## 11. What could not be verified

Everything here was searched for on `developers.cloudflare.com` and not found stated. Each carries the assumption OpsWatch makes and what goes wrong if the assumption is false.

1. **The permission group for `firewallEventsAdaptive`.** Confirmed only indirectly: the GraphQL errors page prescribes *Analytics: Read* as the remedy for any 403 and uses a `firewallEventsAdaptiveGroups` path in its example, but no page names it for that dataset. Assumed *Zone · Analytics · Read*. If wrong, the security-events check reports `denied` for a permission that would not have fixed it.
2. **The permission group for `accessLoginRequestsAdaptiveGroups`.** The tutorial defers to the analytics token page, which documents only *Account Analytics · Read*. Assumed that. Same failure mode as above.
3. **Whether the Zero Trust datasets need *Zero Trust: PII Read* to return user emails and device names.** The group exists and is described as granting read access to Zero Trust PII; nothing says which datasets redact without it. "Top identities" is a list of user emails, so this is the one unknown that could hollow out the page the owner actually asked for. The guide lists the row as optional with an explanation (§5.4).
4. **`GET /accounts` with a scoped API token.** The List Accounts reference has no accepted-permissions section at all and shows only the Global API Key scheme. *Account Settings Read* is the plausible group by description but is not documented on that endpoint. Treated as best effort throughout (§5.3); nothing depends on it.
5. **Which permission the Access applications list endpoint accepts** — *Access: Apps Read* or *Access: Apps and Policies Read*. The reference page could not be retrieved (it repeatedly timed out). The guide ticks the broader of the two.
6. **Whether `GET /user/tokens/verify` accepts an account-owned token.** Not stated either way, which is why §5.2 falls back to `GET /accounts/{account_id}/tokens/verify`.
7. **Whether one custom token can hold Account-scope and Zone-scope permission rows at once.** The editor shows both resource selectors on the same screen, so it is assumed yes, but no worked example was found. If it is not, the guide must tell users to create two tokens and OpsWatch must accept two.
8. **The current dashboard wording for the token screen.** The create-token page says *My Profile > API Tokens* and *Manage Account > API Tokens*; the account-owned-tokens page says *Manage Account > Account API tokens*; the analytics page calls the same screen "the Account API tokens page". All three are live. The guide gives both spellings and the owner confirms against the live dashboard — the same open point Stage 1 recorded for the AWS console labels.
9. **Retention for `httpRequests1hGroups`.** Published nowhere; the `features/data-retention/` URL 404s. The `httpRequestsAdaptive*` figures (7 / 7 / 31 / 90 days) come from the Security Analytics page and the `firewallEventsAdaptive` figures (24 h / 24 h / 3 days / 30 days) from the Security Events page. This is the reason §6 reads the `settings` node at runtime instead of trusting any of them.
10. **The name of the per-record sampling multiplier field.** The sampling page explains adaptive sampling and how to scale a count by the inverse of the rate, but never names the field that carries it; `_sample_interval` is a widely repeated identifier that no official page confirms. The stub does not invent one, and any page built on an adaptive dataset labels its numbers as estimates.
11. **The numeric error codes** for an invalid, disabled or expired token. Only `code: 10000` on HTTP 403 for a permission failure is documented; 6003 and 9109 appear only in community threads. OpsWatch classifies on HTTP status and keeps the numeric code as a hint.
12. **The GraphQL query budget.** Two live official pages disagree — 320 per five minutes in the limits table, 300 on the GraphQL limits page. OpsWatch budgets against 300 (§10). Also unverified: whether the GraphQL endpoint sends `retry-after` at all, which is why throttling is detected from the status and the message rather than from the header alone.
13. **Zero Trust Gateway dataset availability** on a free Zero Trust plan, and the cache-status dimension name in `httpRequestsAdaptiveGroups`. The first is why a dataset that returns nothing is `not_applicable` and not `denied` (§6); the second is the next stage's first job on a real token.

## 12. Definition of done

- `provider` exists on every connection; the migration runs at startup and every pre-existing AWS connection keeps its method, its keys, its status and its stored checklist, with nothing for the owner to do.
- `/accounts/new` opens on four provider cards; AWS opens the Stage 1 wizard unchanged at its new path; Google Cloud and Slack are visible, labelled and inert.
- A Cloudflare connection can be created from a token, the token is encrypted with the existing helpers, and no page, response body or log line contains it.
- The capability test runs the seven checks, and the checklist names the exact dashboard permission for every denied row.
- The guide has a Cloudflare section with the click path, the permission rows, a mock screen and the Global API Key explanation, in English and French, at parity.
- The stub-backed end-to-end suite covers full, partial, no-zone, expired, invalid and throttled tokens; the Stage 1–3 suites still pass; lint, typecheck, build and the dead-code check stay clean.
- §11 is reviewed by the owner against a real Cloudflare account before the guide is published, and each line is either confirmed or corrected in the spec.

## 13. Controller amendments (binding; they override the sections above where they conflict)

1. **No table rebuild.** The `connections` table keeps every existing column exactly as it is. The migration only adds columns: `provider` (text, not null, default `'aws'`) and a nullable encrypted `config` blob for provider-specific settings. A Cloudflare row stores an empty `aws_account_id` and an empty region list, and nothing reads those fields for a non-AWS provider. SQLite adds a column in place, so the owner's live database is never recreated, copied or renamed, and existing AWS rows cannot be lost. The unit test that migrates a Stage 1-shaped database and asserts the rows survive stays required.
2. **No renaming of `region` to `scope`.** The URL keeps its `/c/<connectionId>/<region>/...` shape and the stored `last_test` keeps its current fields for AWS. For Cloudflare the same URL segment carries the scope value (a zone id, or the word `account`), which the loader validates against the connection's own list, and the Cloudflare capability test is stored under its own versioned key rather than reshaping the AWS one. No Stage 2 or Stage 3 page changes meaning, and no AWS user re-runs anything.
3. **The permission mapping is never asserted as fact.** Where the Cloudflare documentation does not name the permission group that grants a dataset, the checklist says what OpsWatch tried, what Cloudflare answered, and the exact message it returned, instead of telling the user to tick a permission we guessed. The guide lists the permissions that are documented, then says plainly that if a check still fails, the message under it names what Cloudflare refused.
4. **Backup before the first migration run.** On startup, before applying a migration that changes the schema, OpsWatch copies the SQLite file next to itself with a timestamped name and keeps the last three copies. This costs one file copy on an upgrade and removes the "it deserves a backup" caveat for every future migration, not only this one.
5. **Slack and Google Cloud stay visible but inert** in the picker, each with one sentence: Slack for sending alerts later, Google Cloud for monitoring a second cloud. No half-built flow behind them.

## 14. Second controller amendment (binding; overrides sections 1-13 where they conflict)

Written after the peer review that found six blocking gaps in §13. Each item below replaces the earlier wording.

1. **Cloudflare connections live in their own table, not in `connections`.** The AWS table keeps every column, every validator and every query untouched: no sentinel values, no nullable change, no rebuild. A new table `provider_connections` holds non-AWS connections: `id` (same id space and generator), `provider`, `name`, `config` (encrypted blob with the token and provider settings), `status`, `last_test` (provider-shaped JSON), `created_at`, `updated_at`. The repository exposes one union type with a `provider` field and a `listConnections()` that merges both tables sorted by name, and a `findConnection(id)` that looks in both. Slack and Google Cloud will reuse the same table later. The `provider` column on the AWS table is dropped from the plan: the table a row lives in is what names its provider.
2. **The capability result renders through a provider-keyed component.** `permission-checklist.tsx` stays exactly as it is for AWS. A sibling renders the Cloudflare result from its own shape, and the connection page picks by provider. No shared shape is forced on two providers that do not have the same idea of a check.
3. **`not_applicable` is only used where the reason is known.** A GraphQL answer that refuses access is reported as `denied` with the message Cloudflare returned, because the documented answers do not distinguish a missing permission from a dataset the plan does not include. `not_applicable` stays for the cases OpsWatch itself knows: no zone to test against, or no account id.
4. **The account id is asked for, not discovered.** The Cloudflare wizard requires it, with the guide showing where to copy it in the dashboard. `GET /accounts` becomes an informational check that never degrades the connection status, since a scoped token may not be allowed to list accounts. No check silently turns into `not_applicable` because discovery failed.
5. **Messages are shown, after redaction.** The message Cloudflare returns is stored and displayed, with identifiers replaced first: any 32-character hexadecimal tag becomes `<zone>`, any account id becomes `<account>`, and anything that looks like a token is never stored at all. This keeps §13.3's promise to show what Cloudflare answered without writing zone and account identifiers into the database, the page and the API response.
6. **The backup is WAL-safe.** The database runs in WAL mode, so a plain file copy can miss committed pages. Before any migration that changes the schema, OpsWatch uses SQLite's own backup API (or, failing that, `PRAGMA wal_checkpoint(TRUNCATE)` and then a copy), keeps the last three copies, and logs where it wrote them.
7. **Running the test is rate limited.** The Cloudflare capability test costs several GraphQL calls, and Cloudflare's budget is a few hundred per five minutes, shared with anything else using the same token. The button waits ten seconds between runs on the client, and the route refuses a second run for the same connection within thirty seconds, with a clear message.
8. **Access audit logs are checked, not only requested.** The permission the guide asks for gets its own check calling the audit-log endpoint, so a token missing only that one is not reported as fully working.
9. **Open questions count ten, not nine.** Add: whether `GET /user/tokens/verify` answers for an account-owned token when no account id is known. The owner reviews the whole list before the guide is published.
10. **Build order.** First the WAL-safe backup and the additive migration with the new table. Then the provider picker, the Cloudflare wizard with token and account id, and the encrypted storage. Then the checks that need no GraphQL: verify the token, list zones, the informational account check. Then the GraphQL checks and the guide's permission table. Anything not finished stops at a phase boundary, never half a phase.
