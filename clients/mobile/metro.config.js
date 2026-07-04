const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the entire workspace root
config.watchFolders = [workspaceRoot];

// Monorepo: resolve modules from workspace root node_modules as well
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Resolve @crossclipper/core directly to its TS source (no build step)
config.resolver.extraNodeModules = {
  "@crossclipper/core": path.resolve(workspaceRoot, "packages/core/src/index.ts"),
};

// Enable symlinks for npm workspaces
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
