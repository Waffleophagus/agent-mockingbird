import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "react-native": path.resolve(
        import.meta.dirname,
        "./__tests__/mocks/react-native.ts"
      ),
      "react-native-url-polyfill/auto": path.resolve(
        import.meta.dirname,
        "./__tests__/mocks/url-polyfill.ts"
      ),
      "react-native-reanimated": path.resolve(
        import.meta.dirname,
        "./__tests__/mocks/react-native-reanimated.ts"
      ),
    },
  },
});
