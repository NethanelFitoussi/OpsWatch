// Learn more: https://docs.expo.dev/guides/customizing-metro/
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The shared API contract lives at the repository root (packages/contract), outside this app. When it is present,
// Metro watches it and resolves its imports (zod) from this app's node_modules, so there is no npm workspace.
const contractDir = path.resolve(__dirname, '../../packages/contract');
if (fs.existsSync(contractDir)) {
  config.watchFolders = [...(config.watchFolders ?? []), contractDir];
  config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
  // `@opswatch/contract` is a directory of TypeScript files, not a published package: there is no node_modules entry
  // to resolve, so the bare specifier is mapped to it here and in tsconfig.json and jest.config.js.
  config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@opswatch/contract': contractDir };
}

module.exports = config;
