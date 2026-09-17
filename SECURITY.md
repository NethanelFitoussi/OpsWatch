# Security policy

## Supported versions

Security fixes are released for the latest minor version only.

## Reporting a vulnerability

Please do not report vulnerabilities in public issues, discussions or pull requests.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Include the affected version, the steps to reproduce and
the impact you expect.

You will receive an acknowledgement within 5 working days. We will keep you informed while
we prepare a fix and credit you in the release notes unless you prefer otherwise.

## Scope

In scope: the OpsWatch application, its Docker image and the CloudFormation template it generates.

Out of scope: vulnerabilities in AWS itself, and deployments that ignore the documented
requirements (for example an instance exposed without HTTPS or with a weak `OPSWATCH_SECRET`).
