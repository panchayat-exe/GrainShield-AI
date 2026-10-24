const { getDefaultConfig } = require("expo/metro-config");
const metroResolver = require("metro-resolver");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

// Windows Metro fallback resolver for platform-specific React Native core modules
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return metroResolver.resolve({ ...context, resolveRequest: null }, moduleName, platform);
  } catch (err) {
    const targetPlatform = platform || "android";
    const extensionsToTry = [
      `.${targetPlatform}.js`,
      `.${targetPlatform}.tsx`,
      `.${targetPlatform}.ts`,
      ".native.js",
      ".android.js",
      ".ios.js",
    ];

    if (context.originModulePath) {
      const originDir = path.dirname(context.originModulePath);
      for (const ext of extensionsToTry) {
        const candidate = path.resolve(originDir, moduleName + ext);
        if (fs.existsSync(candidate)) {
          return { type: "sourceFile", filePath: candidate };
        }
      }
    }

    for (const ext of extensionsToTry) {
      const rnCandidate = path.resolve(__dirname, "node_modules/react-native", moduleName + ext);
      if (fs.existsSync(rnCandidate)) {
        return { type: "sourceFile", filePath: rnCandidate };
      }
    }

    throw err;
  }
};

module.exports = config;
