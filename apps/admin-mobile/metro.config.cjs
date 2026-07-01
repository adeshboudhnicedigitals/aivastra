const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');

config.watchFolders = [workspaceRoot];

const { transformer, resolver } = config;
config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};
config.resolver = {
  ...resolver,
  extraNodeModules: {
    '@aivastra/types': path.resolve(workspaceRoot, 'packages/types/dist/cjs'),
  },
  nodeModulesPaths: [mobileNodeModules, path.resolve(workspaceRoot, 'node_modules')],
  resolveRequest: (context, moduleName, platform) => {
    if (
      moduleName === 'react' ||
      moduleName.startsWith('react/') ||
      moduleName === 'react-native'
    ) {
      return {
        filePath: require.resolve(moduleName, { paths: [mobileNodeModules] }),
        type: 'sourceFile',
      };
    }

    return context.resolveRequest(context, moduleName, platform);
  },
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...resolver.sourceExts, 'svg'],
};

module.exports = config;
