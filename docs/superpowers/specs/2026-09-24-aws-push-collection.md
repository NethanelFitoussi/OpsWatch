# AWS push collection — audit, architecture and decisions

**Status:** binding for the implementation that follows it.
**Scope:** an *optional* push path from a customer's AWS account into **this** OpsWatch instance, beside the
pull path that exists today and stays the default.

---

## 1. What already exists (audit)

Read before writing anything. Everything in this section is in the repository today.

| Concern | Where it lives | State |
|---|---|---|
| AWS connections | `connections` table; `lib/connections/repository.ts` | One row per AWS account, with `regions: string[]`. Multi-account and multi-region already. |
| Credentials | `lib/aws/credentials.ts` | `role` (AssumeRole + ExternalId), `ambient`, `keys`. Cached per `(connection, roleArn, externalId)` with a 5-minute refresh window. **One resolver; do not add a second.** |
| STS | `@aws-sdk/client-sts`, inside that resolver | `RoleSessionName = opswatch-<connectionId>`, `DurationSeconds = 3600`. |
| CloudFormation | `lib/aws/template.ts`, `lib/aws/actions.ts` | **Template v1**: one `AWS::IAM::Role` named `OpsWatchReadOnly-<connectionId>`, one inline policy, two outputs. No Lambda, no queue, no write permission anywhere. Rendered as YAML, optionally uploaded to S3 for a quick-create URL. |
| Trust policy | `lib/aws/identity.ts` (`TrustSpec`) | Principal + `sts:ExternalId` condition, optionally `ArnLike aws:PrincipalArn`. |
| IAM permissions | `SERVICE_GROUPS` in `lib/aws/actions.ts` | Eight read-only groups: ecs, ec2, autoscaling, elb, rds, pi, cloudwatch, logs. `Resource: '*'`, `Effect: Allow`, **no write action of any kind**. `billedActions` already marks the two that cost money. |
| Permission test | `lib/aws/permissions.ts` | Calls one cheap action per group and records `allowed | denied | error` per region. |
| CloudWatch metrics | `lib/monitoring/metrics.ts`, `lib/collector/metrics-job.ts` | `GetMetricData`, batched, capped at 500 series per cycle, gated by the history switch. |
| CloudWatch Logs | `lib/monitoring/logs.ts` | Logs Insights: `StartQuery` / `GetQueryResults` / `StopQuery`, bounded by `OPSWATCH_LOGS_BUDGET_GB_PER_DAY` (a hard stop, not a warning). |
| Alarms | `lib/monitoring/alarms.ts` | `DescribeAlarms`. |
| ECS / EC2 / RDS / ELB / Redis / Kubernetes | `lib/monitoring/*.ts` | All `Describe*` / `List*` through the one credential resolver. |
| CloudTrail | — | **Not used at all.** No permission, no reader. |
| Background jobs | `lib/collector/{jobs,runner,run-job}.ts` | A catalogue of 13 jobs with an interval, a cap, a scope (`environment` or `instance`) and a `freshInstall` flag. One in-process runner, a `collector_lock` row, and `collector_runs` for history. |
| Queue | **none** | No Redis, no BullMQ, no AMQP. The only queue in the product is a **table** — `notify_deliveries` — drained by the `notify` job with bounded exponential backoff. |
| Storage | SQLite, one file | `lib/db/*`. History is **off by default** and its retention is configured (`history_settings`). |
| Outbound webhooks | `lib/notify/{payload,deliver}.ts` | HMAC-SHA256 over `v1:<timestampMs>:<body>`, headers `x-opswatch-signature` / `x-opswatch-timestamp`, constant-time compare. Already tested against fixed vectors. |
| Secrets at rest | `lib/crypto.ts` | AES-GCM under `OPSWATCH_SECRET` with a **purpose-scoped** derivation, so a webhook secret cannot be decrypted by anything that handles AWS keys. |
| Outbound safety | `lib/net/safe-fetch.ts` | SSRF guard: refuses private and link-local address space. |
| API | `src/app/api/v1/**`, `lib/api/v1/routes.ts` | One catalogue, OpenAPI generated from it, `apiJson` / `apiFailure` envelope, closed error-code list, **no CORS header anywhere on purpose**. |
| Auth | session cookie or bearer token from `/auth/login` | One admin per instance today. |

### What is missing for push collection

- no `logs:PutSubscriptionFilter`, `logs:DeleteSubscriptionFilter` or `logs:DescribeSubscriptionFilters`;
- no `cloudformation:*`, no `lambda:*`;
- no ingestion endpoint, no inbound signature verification, no ingestion queue;
- no per-connection feature state: a connection is connected or it is not.

---

## 2. The decision that shapes everything else: **there is no OpsWatch Cloud**

OpsWatch is a self-hosted product. It ships as a container, keeps one SQLite file in `OPSWATCH_DATA_DIR`,
and has one administrator. There is no hosted service to forward anything to, and inventing one in the
documentation would be describing a product that does not exist.

So "managed collection" here means exactly one thing:

```
Customer AWS  →  OpsWatch Forwarder (in the customer's account)  →  this OpsWatch instance
```

The destination is the operator's own `OPSWATCH_PUBLIC_URL`. That is the mission's "customer-hosted
ingestion endpoint", and it is the only destination there is. **The application never phones home.** The UI
says which instance the data goes to, by URL, so the answer to "where does my data go" is on the page.

A consequence worth stating: push collection is only available when `OPSWATCH_PUBLIC_URL` is set to an
address AWS can reach over HTTPS. A laptop install cannot receive a webhook from Lambda, and the page says
so rather than offering a switch that could never work.

---

## 3. Decisions

### D1 — Two stacks, not one stack with conditions

| | Base integration | Managed collection |
|---|---|---|
| Stack | `opswatch-<id>` (template v1, **unchanged**) | `opswatch-<id>-collection` (new, v1) |
| Contains | IAM role, trust policy, read-only policy | Forwarder Lambda, its execution role, its DLQ, the log-group write policy |
| Installed | when the account is connected | **only** when the operator enables managed collection |

Why not one stack with `Conditions`:

- turning the feature on would mean **updating the stack that holds the role every existing install depends
  on**. A failed update to that stack takes the working integration with it. A separate stack cannot.
- an existing customer's base stack stays byte-identical. Nobody is asked to update anything for a feature
  they did not enable (§31).
- turning the feature off is `delete-stack` on one stack, and every resource it created goes with it. No
  `DeletionPolicy: Retain`, no orphans, nothing to sweep.

Cost of the decision: two stacks to install instead of one, for the operators who want push. Accepted.

### D2 — The Lambda exists only when the collection stack exists

Not "installed with zero triggers". Zero AWS footprint when the feature is off is the stronger property and
D1 makes it free: no function, no log group, no DLQ, no invocation, no cost.

### D3 — Ingestion authentication reuses the signature scheme already in the product

`lib/notify/payload.ts` already defines HMAC-SHA256 over `v1:<timestampMs>:<body>` with a constant-time
compare, and it is already tested against fixed vectors. Inbound reuses **the same** scheme and the same
header names rather than inventing a second one. One scheme, one set of tests, one thing to get right.

The shared secret:

- is generated by OpsWatch (32 bytes, `randomToken`), never by the browser and never by CloudFormation;
- is stored encrypted under its own purpose (`aws-ingest`), so it cannot be decrypted by anything that
  handles AWS credentials;
- is shown to the operator **once**, to paste into the stack as a `NoEcho` parameter;
- is never returned to a page again, and never leaves the instance.

**Stated exposure:** the secret lives in the Lambda's environment. Anyone in that AWS account with
`lambda:GetFunctionConfiguration` can read it. It authenticates a forwarder to one OpsWatch instance; it is
not an AWS credential and it grants no read access to anything. Rotation is a stack parameter update plus a
rotation in OpsWatch, and the page says all of this rather than leaving it to be discovered.

### D4 — The ingestion pipeline is a table drained by a collector job

The product's only queue is a table with a retry policy (`notify_deliveries`). Ingestion copies that shape
exactly rather than introducing Redis into a product that has none:

```
POST /api/v1/ingest/aws/logs
  → verify signature, timestamp, size, rate limit, schema, integration, account, region   (synchronous)
  → insert bounded rows into `ingest_events`                                              (synchronous)
  → 202 Accepted                                                                          (returns here)

collector job `ingest`
  → drain a bounded batch, normalise, hand to the existing error detection
  → keep or discard according to the retention setting
```

Expensive work never happens inside the request.

### D5 — Forwarding and persistence are separate switches

`Managed collection = on` does not imply storage. Three independent states per connection:

- `managedCollection` — may anything be forwarded at all;
- `realtimeLogs` — is the log source enabled;
- `persistLogs` — are forwarded records kept after processing, or discarded once processed.

With `persistLogs` off, a record lives in `ingest_events` until the drain job has processed it and is then
deleted. Nothing is silently retained.

### D6 — At-least-once, deduplicated on a derived id

AWS retries. The event id is derived, not invented:

```
sha256(awsAccountId | region | logGroup | logStream | awsEventId)
```

`awsEventId` is CloudWatch's own per-event id. A unique index on that hash makes a replayed batch a
no-op insert rather than a duplicate. Retries in the Lambda are bounded exponential backoff, capped, then
the batch goes to the DLQ — which the UI reports, because a DLQ nobody can see is a silence.

### D7 — Metric streams are prepared for, not built

The ingestion envelope carries a `source` discriminator (`aws.logs` today; `aws.metrics` reserved). A
Firehose delivery can be added later as a second source without reshaping the table, the signature, the
drain job or the UI. No Firehose code ships now.

### D8 — Subscription filters are never silently taken over

Before creating one, OpsWatch calls `DescribeSubscriptionFilters` on that log group. If a filter it does not
own is there, it **refuses and says whose it is**. AWS's limit is what it is at the time of the call; the
code reads the answer rather than hardcoding a number.

Managing them needs three **write** actions — `PutSubscriptionFilter`, `DeleteSubscriptionFilter`,
`DescribeSubscriptionFilters` — and they are granted by the **collection** stack only, on log-group
resources only. The base stack stays read-only for ever.

---

## 4. What is explicitly out of scope

- CloudWatch Metric Streams and Firehose (D7: types only).
- CloudTrail ingestion.
- Any hosted OpsWatch service (§2).
- Deploying anything to a real AWS account. The templates are built and tested here; deployment is the
  operator's action, from the console or the CLI, and OpsWatch never performs it.
