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

const iosBundleId = env('OPSWATCH_IOS_BUNDLE_ID') ?? 'com.example.opswatch';
const androidPackage = env('OPSWATCH_ANDROID_PACKAGE') ?? 'com.example.opswatch';
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
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Face ID is not used; OpsWatch only stores its session token in the Keychain.
      ITSAppUsesNonExemptEncryption: false,
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
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.RECORD_AUDIO'],
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
    'expo-secure-store',
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
  },
});
