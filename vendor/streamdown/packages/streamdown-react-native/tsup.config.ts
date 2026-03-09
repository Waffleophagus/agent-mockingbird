import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  entry: ["index.tsx"],
  format: ["esm"],
  minify: true,
  outDir: "dist",
  sourcemap: false,
  external: ["react", "react-native", "react-native-reanimated"],
  treeshake: true,
  splitting: true,
  platform: "neutral",
});
