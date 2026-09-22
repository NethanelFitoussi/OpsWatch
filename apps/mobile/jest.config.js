/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/dist/', '/dist-web/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@tanstack/.*|zod|standard-navigation)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // The shared contract is a directory of TypeScript files at the repository root, not an installed package.
    '^@opswatch/contract$': '<rootDir>/../../packages/contract/index.ts',
    // The shared contract lives outside this app (packages/contract, or a checkout of it during a parity run) and
    // has no node_modules of its own, so its zod import resolves to this app's copy.
    '^zod$': '<rootDir>/node_modules/zod',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/demo/fixtures/**'],
};
