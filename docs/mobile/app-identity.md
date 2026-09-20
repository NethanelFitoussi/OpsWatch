# App identity

Everything that identifies the app to Apple, Google and Expo is a placeholder today. `app.config.ts` reads these
values from environment variables so that whoever publishes the app sets their own, and defaults to
`com.example.*`, which both stores reject. `eas.json` sets the same two placeholders in `build.base.env`, so cloud
builds inherit them until they are changed there too.

> **Requires owner action.** Each row below is a decision for the owner. Several values can never change after the
> first store release. The migration steps are in [release.md](release.md#3-replace-the-placeholder-identifiers).

| Item | Current value | Set with | Changeable later? |
|------|---------------|----------|-------------------|
| App name | `OpsWatch` | `name` in `app.config.ts` | Yes (store listing name must be unique per store) |
| iOS bundle identifier | `com.example.opswatch` | `OPSWATCH_IOS_BUNDLE_ID`, and `eas.json` `base.env` | **No**, after the first App Store submission |
| Android package | `com.example.opswatch` | `OPSWATCH_ANDROID_PACKAGE`, and `eas.json` `base.env` | **No**, after the first Play upload |
| Expo owner | unset | `EXPO_OWNER` | Yes (transferring projects has consequences for EAS) |
| Expo slug | `opswatch` | `slug` in `app.config.ts` | Avoid: it names the EAS project |
| EAS project id | unset | `EAS_PROJECT_ID` (from `eas init`) | No: tied to the project |
| URL scheme | `opswatch` | `scheme` in `app.config.ts` | Avoid: deep links and the Google redirect use it |
| Associated domain | unset | `OPSWATCH_ASSOCIATED_DOMAIN` (read by both platforms from `extra.associatedDomain`) | Yes |
| Version | `0.1.0` | `VERSION` in `app.config.ts` + `package.json` | Every release |
| iOS build number | `1` locally; EAS owns it for cloud builds | `OPSWATCH_IOS_BUILD_NUMBER`, or EAS `autoIncrement` | Must increase every upload |
| Android versionCode | `1` locally; EAS owns it for cloud builds | `OPSWATCH_ANDROID_VERSION_CODE`, or EAS `autoIncrement` | Must increase every upload |

Suggested identifiers: a reverse-DNS name of a domain the owner controls, identical on both platforms, for example
`com.yourcompany.opswatch`. Example shell setup (or EAS environment variables, [expo-eas.md](expo-eas.md)):

```bash
export OPSWATCH_IOS_BUNDLE_ID=com.yourcompany.opswatch
export OPSWATCH_ANDROID_PACKAGE=com.yourcompany.opswatch
export EXPO_OWNER=yourcompany
export EAS_PROJECT_ID=<id printed by eas init>
```

None of these values is secret.

## Universal links and Android App Links

Optional. With them, `https://<domain>/m/problems/<id>` opens the app when installed (and the web page otherwise).
The app accepts only links on that domain whose path starts with `/m/`, then applies the same allow-list as
`opswatch://` links ([architecture.md](architecture.md#deep-links)).

Setting `OPSWATCH_ASSOCIATED_DOMAIN=ops.example.com` adds:

- iOS: `applinks:ops.example.com` to associated domains.
- Android: an auto-verified intent filter for `https://ops.example.com/m/*`.

Both platforms read the domain from `extra.associatedDomain`, so neither depends on the other's config block.

Because OpsWatch is self-hosted, links only verify for the domain baked into the build. A build published to the
stores can only claim domains its publisher controls; users on other domains keep using `opswatch://` links.

The OpsWatch server on that domain must serve two files over HTTPS, without redirects, with
`Content-Type: application/json`:

`/.well-known/apple-app-site-association` (no file extension):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAMID>.com.yourcompany.opswatch"],
        "components": [{ "/": "/m/*" }]
      }
    ]
  }
}
```

`<TEAMID>` is the Apple Developer Team ID.

`/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.yourcompany.opswatch",
      "sha256_cert_fingerprints": ["<SHA-256 of the Play app signing certificate>"]
    }
  }
]
```

Use the **app signing key** fingerprint from Play Console (App integrity), not only the upload key; add the upload
key's fingerprint too if you test with EAS-signed builds outside Play.

Serving these files is a server-side change to agree with the server team ([api-contract.md](api-contract.md)).
Universal links have never been tested: no domain is configured and iOS has never been run.

## Icons and splash

All image assets in `apps/mobile/assets/` are **Expo template placeholders** and must be replaced with OpsWatch
artwork before any release.

| File | Use | Specification |
|------|-----|---------------|
| `assets/icon.png` | iOS app icon and default icon | 1024×1024 PNG, no transparency, no rounded corners (the OS masks it) |
| `assets/android-icon-foreground.png` | Android adaptive icon foreground | Square PNG with transparency (template: 512×512; 1024×1024 recommended); keep the logo inside the central safe zone (about the middle 66 %) |
| `assets/android-icon-background.png` | Android adaptive icon background | Square PNG, same size as the foreground; `backgroundColor` is also `#0B1220` |
| `assets/android-icon-monochrome.png` | Android 13+ themed icon | Square PNG (template: 432×432), single colour on transparency |
| `assets/splash-icon.png` | Splash screen logo | Square PNG with transparency (template: 1024×1024), shown 160 pt wide on `#F6F7F9` (light) and `#0B1220` (dark) |
| `assets/favicon.png` | Web target favicon | 48×48 PNG |

Store listing icons are separate uploads: 1024×1024 is taken from the build on iOS; Google Play needs a 512×512 PNG
([android.md](android.md#store-listing-and-assets)).

## Version and build numbers

- `version` (`0.1.0`): the user-visible version. Change it in `app.config.ts` (`VERSION`) and `package.json` together.
  It is also the EAS Update runtime version.
- iOS `buildNumber` and Android `versionCode`: integers that must increase with every store upload. `eas.json` uses
  `appVersionSource: "remote"`, so EAS keeps and increments them for cloud builds; the values in `app.config.ts` only
  matter for local builds.

Process and the full versioning rules: [release.md](release.md).
