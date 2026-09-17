# OpsWatch

**Self-hosted, open source monitoring for your AWS containers, databases and logs.**

[Français](README.fr.md) · [License: MIT](LICENSE)

OpsWatch runs on your own infrastructure and reads your AWS accounts with read-only access.
Nothing leaves your network: no SaaS, no agent to install in your workloads.

![Getting started guide](docs/screenshots/getting-started-light.png)

## Status

OpsWatch is built in stages. This release covers the foundations:

| Stage | Content | Status |
|-------|---------|--------|
| 1 | Admin account, AWS connections, permission test, getting started guide (English and French) | Available |
| 2 | Containers: ECS clusters, services, tasks, load balancers | Planned |
| 3 | Databases: RDS and Aurora metrics, Performance Insights | Planned |
| 4 | Logs: CloudWatch Logs search and Logs Insights | Planned |
| 5 | Automatic analyses and on-demand snapshots saved from the dashboard | Planned |

## Quick start

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/<owner>/opswatch.git
cd opswatch
cp .env.example .env
# Put at least 32 random characters in OPSWATCH_SECRET:
sed -i "s|^OPSWATCH_SECRET=.*|OPSWATCH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
docker compose up -d --build
```

Open http://localhost:3000. The first visit asks you to create the admin account, then the
getting started guide walks you through connecting an AWS account.

OpsWatch refuses to start if `OPSWATCH_SECRET` is missing or shorter than 32 characters.
Keep this value safe: it encrypts stored access keys and signs sessions, and changing it
signs everyone out and makes stored keys unreadable.

## Connecting AWS

![Connection with its permission checklist](docs/screenshots/connection.png)

OpsWatch offers three methods. The guide inside the application explains each one step by step.

1. **IAM role (recommended).** OpsWatch generates a CloudFormation template that creates a
   read-only role named `OpsWatchReadOnly-<id>` in the monitored account. The role trusts only
   OpsWatch's own AWS identity, and only when it presents a random ExternalId unique to the
   connection. OpsWatch assumes the role and receives temporary credentials valid for one hour.
2. **Ambient credentials.** OpsWatch uses the identity it already runs with: an ECS task role,
   an EC2 instance profile, or a profile from a mounted `~/.aws` directory.
3. **Access keys.** An IAM user's access key pair, encrypted at rest. Use this only when the
   other two methods are not possible.

After connecting, **Run test** calls one read-only action per service and region, and shows
what OpsWatch can and cannot see.

## Security model

- Every AWS call runs on the server. Credentials never reach the browser.
- The generated role only allows read actions: the full list is in the guide and in
  `src/lib/aws/actions.ts`. OpsWatch's own identity only needs `sts:AssumeRole` on
  `arn:aws:iam::*:role/OpsWatchReadOnly-*`.
- The ExternalId prevents another OpsWatch instance, or anyone who learns the role ARN,
  from assuming the role.
- Access keys are encrypted with AES-256-GCM using a key derived from `OPSWATCH_SECRET`.
- A single admin account protects the instance. Passwords are hashed with argon2id, sessions
  expire after 12 hours of inactivity, and sign-in attempts are limited to 5 per minute per client and 20 per minute in total.
- Put OpsWatch behind HTTPS and set `OPSWATCH_PUBLIC_URL` so cookies are marked `Secure`.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPSWATCH_SECRET` | Yes, 32+ characters | Encrypts stored access keys and signs sessions |
| `OPSWATCH_DATA_DIR` | No, default `/data` | Location of the SQLite database |
| `OPSWATCH_PUBLIC_URL` | No | Public URL; enables `Secure` cookies over HTTPS |
| `OPSWATCH_TEMPLATE_BUCKET` | No | S3 bucket that enables the "Launch Stack" button |
| `AWS_*`, `AWS_PROFILE` | For role and ambient methods | OpsWatch's own AWS identity |
| `OPSWATCH_AWS_ENDPOINT_URL` | Tests only | Sends every AWS call to a moto server |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
