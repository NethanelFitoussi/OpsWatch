# OpsWatch mobile changelog

All notable changes to the mobile app. Versions follow [Semantic Versioning](https://semver.org/). Release tags use
the `mobile-v` prefix ([release.md](release.md)).

## Unreleased

Not yet published to any store.

- Expo SDK 57 app for iOS and Android, English and French, light and dark themes.
- Connect to any self-hosted OpsWatch server over HTTPS; capability discovery through `GET /api/v1/server`.
- Sign-in with email and password; Google sign-in with PKCE when the server supports it.
- Home, Morning Brief, Problems, Alerts, Services, Errors, Logs, Infrastructure, Deployments, Incidents, Synthetics,
  SLOs, Investigations, Evidence, Ask OpsWatch, Search, Settings.
- 24 h offline cache of glanceable lists, marked stale when not live.
- Deep links through an allow-list; local notifications and notification routing (remote push pending server support).
- Demo mode and a contract mock server.
