import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "openclaw/**",
      "opencode/**",
      "opencode-sdk-js/**",
      "convex-backend/**",
      "rivet/**",
      "sandbox-agent/**",
      "data/**",
      "runtime-assets/**",
      "apps/mobile/.expo/**",
      "apps/mobile/web-build/**",
      "apps/server/src/test-embedded.ts",
      "apps/server/src/test-embedded2.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: [
            "./tsconfig.json",
            "./apps/*/tsconfig.json",
            "./packages/*/tsconfig.json",
          ],
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "import/order": [
        "error",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: [["builtin", "external"], "internal", ["parent", "sibling", "index"]],
          "newlines-between": "always",
        },
      ],
      "import/no-duplicates": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-console": ["warn", { allow: ["log", "warn", "error"] }],
    },
  },
);
