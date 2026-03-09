const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);
const streamdownRoot = "/var/home/matt/Documents/random-vibecoded-stuff/streamdown";
const appNodeModules = path.resolve(__dirname, "node_modules");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");

config.watchFolders = [...(config.watchFolders ?? []), streamdownRoot];
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [
  appNodeModules,
  rootNodeModules,
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.join(appNodeModules, "react"),
  "react-native": path.join(appNodeModules, "react-native"),
  "react-native-reanimated": path.join(appNodeModules, "react-native-reanimated"),
  "react-native-worklets": path.join(appNodeModules, "react-native-worklets"),
};
config.resolver.blockList = [
  new RegExp(
    `${streamdownRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/node_modules\\/.*`
  ),
];

module.exports = withNativeWind(config, {
  input: "./global.css",
});
