# AWS push collection — reference

The in-product guide (**Docs → Sending logs to OpsWatch as they happen**) is what an operator reads. This
is the reference for whoever has to review the AWS side: exactly what is created, exactly what is granted,
and exactly what happens when it is removed.

---

## 1. Two ways OpsWatch reads AWS

```
 DIRECT (default, always available)          MANAGED (optional, off)

 OpsWatch                                    Your AWS account
    │ sts:AssumeRole                            │ CloudWatch Logs
    ▼                                           ▼ subscription filter
 Your AWS account                            OpsWatch Forwarder (Lambda)
    ├── Describe* / List*                       │ HTTPS, signed
    ├── cloudwatch:GetMetricData                ▼
    ├── cloudwatch:DescribeAlarms            Your OpsWatch instance
    └── logs:StartQuery (Insights)              └── queue → process → optional retention
```

**Connecting an account enables only the left-hand side.** Resources, metrics, alarms and log search all
work there. Managed collection exists for lines arriving continuously rather than on request; it is a
separate, confirmed decision, per account.

There is no hosted OpsWatch service. The forwarder delivers to the instance you run, at the address in
`OPSWATCH_PUBLIC_URL`, and the collection page shows that address.

---

## 2. What CloudFormation creates

### Base stack — `opswatch-<connectionId>` (unchanged by this feature)

| Resource | Why |
|---|---|
| `AWS::IAM::Role` `OpsWatchReadOnly-<id>` | The role OpsWatch assumes. Read-only, `ExternalId`-conditioned. |

### Collection stack — `opswatch-<connectionId>-collection` (only if you enable managed collection)

| Resource | Why |
|---|---|
| `AWS::Lambda::Function` | The forwarder. `nodejs22.x`, arm64, 256 MB, 30 s, code inline (~3.3 kB). |
| `AWS::IAM::Role` | Its execution role: write to **its own** log group, send to **its own** DLQ. Nothing else. |
| `AWS::Logs::LogGroup` | The forwarder's own logs, with a retention you choose. Declared so it does not outlive the stack. |
| `AWS::SQS::Queue` | Dead-letter queue for batches the forwarder gave up on. SQS-managed encryption. |
| `AWS::Lambda::Permission` | Lets CloudWatch Logs invoke the function, restricted by `SourceAccount`. |
| `AWS::IAM::Policy` | The subscription-management permissions, **attached to the existing read-only role**. |

Nothing has `DeletionPolicy: Retain`. Deleting the collection stack removes all six.

**Why two stacks.** Turning the feature on never updates the stack that holds the role every part of
OpsWatch depends on — a failed update there would take a working integration with it. And turning the
feature off is one `delete-stack` with nothing left behind.

---

## 3. IAM: every permission and why

### Base (already installed, unchanged)

Read-only across ecs, ec2, application-autoscaling, elasticloadbalancing, rds, pi, cloudwatch and logs.
`SERVICE_GROUPS` in `src/lib/aws/actions.ts` is the list. **No write action of any kind**, and a test
asserts it.

### Collection stack only

| Action | Resource | Why |
|---|---|---|
| `logs:DescribeSubscriptionFilters` | log groups of this account | To see whose filter is on a log group **before** writing one. |
| `logs:PutSubscriptionFilter` | log groups of this account | To start forwarding a group you ticked. |
| `logs:DeleteSubscriptionFilter` | log groups of this account | To stop. A feature that can only be switched on is not optional. |
| `lambda:GetFunctionConfiguration` | the forwarder only | To read its version from AWS rather than believe a form. |
| `sqs:GetQueueAttributes` | the DLQ only | To report undelivered batches. A DLQ nobody can see is a silence. |

The three log-group actions are scoped to log-group ARNs because AWS accepts nothing narrower. **The code
is the narrower rule**: OpsWatch reads every filter on a group and writes or deletes only one whose name
begins `OpsWatch-`. It never touches another product's.

---

## 4. Security

| Concern | What is done |
|---|---|
| Authentication | HMAC-SHA256 over `v1:<timestampMs>:<body>`, headers `x-opswatch-integration`, `x-opswatch-timestamp`, `x-opswatch-signature`. The same scheme OpsWatch already uses for outbound webhooks. |
| Replay | The timestamp must be within five minutes **in both directions**, and every record carries a derived id with a unique index, so a replayed batch inserts nothing. |
| Secret at rest | Encrypted under `OPSWATCH_SECRET` with an `aws-ingest` purpose derivation. Shown to the operator once, never returned to a page again. |
| Secret in AWS | A `NoEcho` CloudFormation parameter, then a Lambda environment variable. **Anyone in that account with `lambda:GetFunctionConfiguration` can read it.** It authenticates a forwarder to one OpsWatch instance; it is not an AWS credential and grants no access to anything. Rotate from the collection page, then update the stack parameter. |
| Transport | HTTPS only. The template's endpoint parameter is `AllowedPattern: ^https://.+`, and the forwarder refuses a non-HTTPS endpoint at start-up. |
| Body size | `content-length` refused over 1 MB before buffering; actual bytes refused over 1 MB; decompressed output bounded at 8 MB **inside zlib**, so a gzip bomb dies in the decompressor. |
| Schema | zod, with a **strict** source enum — an unknown source is refused, not coerced. |
| Tenancy | The signature identifies the integration. The body's `awsAccountId` must match that connection's, the `region` must be one it has, and the `logGroup` must be one an operator ticked. Every store query filters on the connection. |
| Rate | 100,000 records per minute per integration, counting accepted, refused and repeated. |
| Information disclosure | Everything a signature could not establish answers `401 {"error":"unauthorized"}` with the same body, so a caller cannot enumerate integrations or learn which check failed. |
| Lambda logs | The forwarder never puts the secret in a header it logs, a body, an error message or a stack. Network failures are reported as a class (`network`, `timeout`), never as the underlying message. |
| CORS | None, on this endpoint or any other. |
| Public endpoints | No Lambda function URL. The invoke permission is restricted to this account's log groups. |

**Known limitation.** Requests whose signature does not verify cannot be attributed to an integration, so
they are not rate-limited by OpsWatch. A self-hosted instance exposed to the internet should have the
usual reverse-proxy limits in front of it, as it should for `/api/v1/auth/login`.

---

## 5. Cost

OpsWatch does not print a price, because AWS pricing depends on the account and region. It shows usage:
records accepted, refused and repeated, and bytes received, per hour, on the collection page.

AWS may charge for:

- Lambda invocations and duration (one invocation per CloudWatch Logs delivery);
- the CloudWatch Logs the forwarder writes **about itself** (retention is a stack parameter, default 7 days);
- data transfer out of your account;
- SQS, if batches reach the dead-letter queue.

It does **not** add Logs Insights cost. The opposite: a forwarded log group is no longer queried by the
`errors` job, so the per-gigabyte scanning for that group stops.

---

## 6. Installing

1. Connect the AWS account as usual. Stop here if you do not want push collection — everything works.
2. Account → Managed collection → read, confirm, enable. Copy the secret; it is shown once.
3. Download `opswatch-<id>-collection.yaml` and deploy it with `CAPABILITY_NAMED_IAM`, passing
   `OpsWatchIngestSecret`.
4. Paste the `ForwarderArn` output back into OpsWatch and press Verify. OpsWatch asks AWS to confirm it.
5. Turn on **Real-time logs** and start the log groups you want, one at a time.

## 7. Upgrading

The forwarder's version is in the template, in the function's environment, in every request it makes and
in every answer OpsWatch gives. When this instance ships a newer one than the function reports, the
collection page says so. Upgrading is `aws cloudformation deploy` over the same stack: the function is
replaced, the subscription filters keep pointing at the same ARN, and **nothing is reconnected**.

## 8. Uninstalling

1. Collection page → **Turn off managed collection**. OpsWatch removes every subscription filter it
   created, forgets the secret, and drops queued and kept records. It reports any filter it could not
   remove, because that one is still costing you invocations.
2. `aws cloudformation delete-stack --stack-name opswatch-<id>-collection`. The function, its role, its
   log group, the queue and the policy all go.
3. The AWS connection and the base stack are untouched. Direct mode keeps working.

To remove OpsWatch entirely, also delete `opswatch-<id>` and the connection in OpsWatch.

---

## 9. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| Forwarder says *Nothing heard yet* | Nothing has arrived and nothing has been refused | Not a fault. A quiet log group reads exactly like this. Write a line to a forwarded group. |
| Forwarder says *Degraded* | A real share of what arrives is being refused | Check the account, region and log group the forwarder claims match this connection. A group unticked in OpsWatch but still subscribed in AWS produces exactly this. |
| Forwarder says *Undelivered batches* | The DLQ is not empty | The forwarder could not reach this instance. Check `OPSWATCH_PUBLIC_URL` resolves and is reachable from AWS, and that a proxy is not refusing a 1 MB POST. |
| *Another product is already subscribed* | A non-OpsWatch filter is on that log group | OpsWatch will not replace it. Remove it, or forward a different group. |
| AWS refuses `PutSubscriptionFilter` | The collection stack is missing or `OpsWatchRoleName` did not match | Redeploy the collection stack with the correct role name. |
| `401` in the forwarder's own logs | The secret in the stack is not the one OpsWatch holds, or the clock is off by over five minutes | Rotate the secret in OpsWatch and update the stack parameter; check the instance's clock. |
| `429` in the forwarder's own logs | Over 100,000 records a minute from one integration | The forwarder retries with backoff. Forward fewer groups, or the busiest one is busier than expected. |
| Records arrive but no errors appear | The log group's format is not configured | Errors → Sources: set the format and field map. A forwarded group gets a parked source row with no parsing rules until then. |
| CloudFormation fails on `OpsWatchCollectionPolicy` | The named role does not exist | The base stack must be installed first, and `OpsWatchRoleName` must match it. |
