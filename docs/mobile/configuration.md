# Configuration reference

Every environment variable and configuration value the mobile app reads, what it is for, and whether it ends up
inside the app binary.

## The rule that governs this whole file

**Nothing here is a secret, and nothing here may become one.** Everything the app is configured with is compiled into
a binary that anyone who installs the app can unpack and read. There is no such thing as a private value in a mobile
app.

The mobile app therefore never holds an **AWS, GitHub, Cloudflare or AI provider credential**. It talks to exactly one
thing — the OpsWatch server the user chose — and that server holds the integrations. If you ever find yourself wanting
to put a provider key in `.env` here, the feature belongs on the server instead.

The one credential the app does handle is the user's own session token, which is obtained at sign-in and kept in the
iOS Keychain / Android Keystore, never in configuration. See [security.md](security.md) and [privacy.md](privacy.md).

## Where configuration lives

| File | Committed? | What it is |
|---|---|---|
| `apps/mobile/.env.example` | Yes | The template. Copy it to `.env` and edit. It contains no values, only names and explanations |
| `apps/mobile/.env` | **No** — git-ignored | Your local values. Expo loads it automatically |
| `apps/mobile/app.config.ts` | Yes | Reads the variables below and produces the Expo config. Nothing secret |
| `apps/mobile/eas.json` | Yes | Cloud build profiles. Deliberately sets **no** identifiers, so an EAS environment variable is not shadowed |
| EAS environment variables | n/a | Where cloud builds get their values. Set with `eas env:create` or in the Expo dashboard |

```bash
cd apps/mobile
cp .env.example .env
```

Expo reads `.env` for you. Only names beginning `EXPO_PUBLIC_` are readable from application code at runtime; the
others are read by `app.config.ts` while the config is evaluated, which happens on your machine or on the EAS builder.

## The variables

All of them are optional. With none set, the app builds with placeholder store identifiers and asks for a server URL
on first launch — which is exactly right for local development and for the demo.

| Name | Used when | Purpose | Safe example | In the binary? |
|---|---|---|---|---|
| `EXPO_PUBLIC_DEFAULT_SERVER_URL` | Development | Pre-fills the server URL on the Connect screen so you do not retype it after every reinstall | `http://10.0.2.2:4010` | **Yes, by design** (`EXPO_PUBLIC_`) |
| `OPSWATCH_IOS_BUNDLE_ID` | Release | The iOS bundle identifier. **Required** for the `production` profile, which refuses to build on the placeholder | `com.yourcompany.opswatch` | Yes (it is the app's identity) |
| `OPSWATCH_ANDROID_PACKAGE` | Release | The Android application id. Same rule | `com.yourcompany.opswatch` | Yes |
| `OPSWATCH_ASSOCIATED_DOMAIN` | Release | Enables Universal Links and Android App Links for that domain. Without it, only `opswatch://` links work | `ops.yourcompany.com` | Yes |
| `EXPO_OWNER` | EAS builds | The Expo account that owns the project. `eas init` sets it | `your-expo-account` | No |
| `EAS_PROJECT_ID` | EAS builds | The EAS project. `eas init` sets it | `00000000-0000-0000-0000-000000000000` | No |
| `OPSWATCH_IOS_BUILD_NUMBER` | Local native build only | iOS build number. EAS owns this for cloud builds (`appVersionSource: "remote"`), so set it only for a build you upload by hand | `1` | Yes |
| `OPSWATCH_ANDROID_VERSION_CODE` | Local native build only | Android `versionCode`. Same rule | `1` | Yes |
| `EXPO_PUBLIC_SCREENSHOT_AT` | Store screenshots only | Pins the demo's clock to an epoch in milliseconds so a regenerated screenshot set differs only where the UI changed. Unset, the app behaves normally ([store-assets.md](store-assets.md)) | `1773740520000` | Yes, when set |
| `OPSWATCH_STORE_LOCALE` | Store screenshots only | Which language to capture, `en` or `fr`. Read by the capture scripts, not by the app | `fr` | No |
| `OPSWATCH_CONTRACT_DIR` | Running the parity test | Points the contract parity suite at a checkout of `packages/contract`. Not read by the app | `../../../opswatch/packages/contract` | No |
| `EAS_BUILD_PROFILE` | Set by EAS | Which profile is building. `app.config.ts` uses it to refuse a `production` build on placeholder identifiers | *(set for you)* | No |

None of these is secret. There is nothing in this table you need to protect.

## What is genuinely secret, and where it lives instead

| Secret | Where it belongs | Never |
|---|---|---|
| AWS, GitHub, Cloudflare, AI provider credentials | The OpsWatch server | In the app, in `.env`, in `eas.json`, in a build |
| The Android upload keystore and its passwords | EAS credentials, or a password manager and an encrypted backup | Committed. `*.keystore` is git-ignored ([android.md](android.md#signing)) |
| Apple certificates and provisioning profiles | EAS credentials, or your Mac's keychain | Committed |
| A user's session token | The device Keychain / Keystore, written at sign-in | Configuration, logs, a notification payload |

## Values that are not environment variables

| Value | Where | Notes |
|---|---|---|
| App version (`0.1.0`) | `const VERSION` in `app.config.ts`, and `version` in `package.json` | The two must agree; [release.md](release.md#1-versioning) explains why |
| URL scheme (`opswatch://`) | `scheme` in `app.config.ts` | Changing it breaks existing deep links |
| Android permissions | Generated from the config and the libraries used | The blocked list is in `app.config.ts`; the real merged list is in [privacy.md](privacy.md#android-permissions-actually-in-the-release-build) |
| API prefix and version (`/api/v1`) | `src/api/contract.ts` | Shared with the server; see [api-contract.md](api-contract.md) |

## Checking your configuration

```bash
cd apps/mobile
npx expo config --type public            # the resolved config, including identifiers
npm run doctor                           # expo-doctor: dependency and config checks
npm test -- docs-match-project           # the documentation and this table still match the project
```

`dev/__tests__/docs-match-project.test.ts` fails if a variable is added to `app.config.ts` and not documented here, or
documented here and not read anywhere — so this table cannot quietly drift away from the code.
