const { getDefaultConfig } = require("expo/metro-config");
const metroResolver = require("metro-resolver");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

const rnRoot = path.resolve(__dirname, "node_modules/react-native");

// Windows Metro fallback resolver for platform-specific React Native core modules and path aliases
config.resolver.resolveRequest = (context, moduleName, platform) => {
  let targetModuleName = moduleName;

  // 1. Fast path for @/ path aliases directly
  if (targetModuleName.startsWith("@/")) {
    targetModuleName = path.resolve(__dirname, targetModuleName.slice(2));
  }

  // 2. Fast path for known React Native platform-only modules on Windows
  const targetPlatform = platform || "android";
  if (
    targetModuleName === "./Libraries/Image/Image" ||
    targetModuleName.endsWith("/Libraries/Image/Image") ||
    targetModuleName === "./Libraries/Utilities/Platform" ||
    targetModuleName === "./Libraries/Utilities/BackHandler" ||
    targetModuleName === "./Libraries/Network/RCTNetworking"
  ) {
    const candidate = path.resolve(rnRoot, targetModuleName.replace(/^\.\//, "") + "." + targetPlatform + ".js");
    if (fs.existsSync(candidate)) {
      return { type: "sourceFile", filePath: candidate };
    }
  }

  // 3. Normal Metro resolution
  try {
    return metroResolver.resolve({ ...context, resolveRequest: null }, targetModuleName, platform);
  } catch (err) {
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
        const candidate = path.resolve(originDir, targetModuleName + ext);
        if (fs.existsSync(candidate)) {
          return { type: "sourceFile", filePath: candidate };
        }
      }
    }

    for (const ext of extensionsToTry) {
      const rnCandidate = path.resolve(rnRoot, targetModuleName + ext);
      if (fs.existsSync(rnCandidate)) {
        return { type: "sourceFile", filePath: rnCandidate };
      }
    }

    throw err;
  }
};

module.exports = config;
