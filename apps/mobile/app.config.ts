import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * OpsWatch mobile app configuration.
 *
 * Store identifiers belong to whoever publishes the app, so they are read from the environment and default to
 * obvious placeholders (`com.example.*`) that the stores reject. See docs/mobile/app-identity.md.
 * Nothing in this file is secret: every value ends up inside the public app binary.
 */
const VERSION = '0.1.0';

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const PLACEHOLDER_ID = 'com.example.opswatch';
const iosBundleId = env('OPSWATCH_IOS_BUNDLE_ID') ?? PLACEHOLDER_ID;
const androidPackage = env('OPSWATCH_ANDROID_PACKAGE') ?? PLACEHOLDER_ID;

/**
 * A store identifier cannot be changed after the first release: shipping `com.example.opswatch` would take the name
 * permanently and force a new listing to undo. The placeholders are what every local and preview build should use,
 * so they are only refused for the one profile that produces a build meant for a store.
 */
if (env('EAS_BUILD_PROFILE') === 'production' && (iosBundleId === PLACEHOLDER_ID || androidPackage === PLACEHOLDER_ID)) {
  throw new Error(
    'Refusing to build the production profile with the placeholder identifier com.example.opswatch. ' +
      'Set OPSWATCH_IOS_BUNDLE_ID and OPSWATCH_ANDROID_PACKAGE as EAS environment variables first (docs/mobile/release.md).',
  );
}
const easProjectId = env('EAS_PROJECT_ID');
const associatedDomain = env('OPSWATCH_ASSOCIATED_DOMAIN');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'OpsWatch',
  slug: 'opswatch',
  owner: env('EXPO_OWNER'),
  version: VERSION,
  scheme: 'opswatch',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: iosBundleId,
    buildNumber: env('OPSWATCH_IOS_BUILD_NUMBER') ?? '1',
    supportsTablet: true,
    associatedDomains: associatedDomain ? [`applinks:${associatedDomain}`] : undefined,
    infoPlist: {
      // OpsWatch uses only HTTPS to the server the user configures; no exemption paperwork applies.
      ITSAppUsesNonExemptEncryption: false,
      // Replaces the Expo dev-launcher wording, which would otherwise ship to the App Store. A release build asks
      // for the local network only to reach an OpsWatch server on the same network.
      NSLocalNetworkUsageDescription: 'OpsWatch connects to the OpsWatch server you configure. It needs local network access only when that server runs on this network.',
    },
  },
  android: {
    package: androidPackage,
    // The offline cache holds service and incident names: keep it out of Google Drive device backups.
    allowBackup: false,
    versionCode: Number(env('OPSWATCH_ANDROID_VERSION_CODE') ?? '1'),
    adaptiveIcon: {
      backgroundColor: '#0B1220',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Only what the app needs: network access and notifications. No location, camera, contacts or storage.
    permissions: ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'],
    // Dependencies merge permissions of their own into the manifest; an observability client needs none of these.
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    // Cleartext HTTP is refused by Android by default; it stays refused in release builds.
    intentFilters: associatedDomain
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: associatedDomain, pathPrefix: '/m/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : undefined,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    // OpsWatch never asks for biometric authentication, so the Face ID prompt this plugin adds by default is removed:
    // it would otherwise claim in the App Store listing that the app accesses Face ID data.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-web-browser',
    'expo-localization',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#F6F7F9',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#0B1220' },
      },
    ],
    [
      'expo-notifications',
      {
        color: '#2563EB',
        defaultChannel: 'opswatch-alerts',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    // Public, optional: pre-fills the server URL field. Never a secret.
    defaultServerUrl: env('EXPO_PUBLIC_DEFAULT_SERVER_URL'),
    // Store screenshots only: pins the demo's clock so a regenerated set differs only where the UI changed.
    screenshotAt: env('EXPO_PUBLIC_SCREENSHOT_AT'),
    // Read on both platforms for universal/app links, so neither one depends on the other's config block.
    associatedDomain,
  },
});
