// Override the expo package's android autolinking config.
// expo/react-native.config.js fails to load inside expo-modules-autolinking's
// requireFromString sandbox (the require('expo-modules-autolinking/exports') call
// is silently caught), causing the fallback to resolve expo.core.ExpoModulesPackage
// (the android namespace) instead of the correct expo.modules.ExpoModulesPackage.
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
          packageInstance: 'new ExpoModulesPackage()',
        },
      },
    },
  },
};
