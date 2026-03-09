# @streamdown/code-native

React Native Shiki code-highlighting plugin for Streamdown.

This package targets native highlighting with:
- `@shikijs/core`
- `react-native-shiki-engine`

## Status

Baseline implementation is available with:
- fail-fast native engine checks
- async highlighting with token cache
- language/theme configuration via `createNativeCodePlugin`

## Install (pnpm)

```bash
pnpm add @streamdown/code-native @shikijs/core react-native-shiki-engine
```

## Example

```ts
import { createNativeCodePlugin } from "@streamdown/code-native";

const code = createNativeCodePlugin({
  langs: [
    // pass Shiki language grammar modules
  ],
  themes: [
    // pass Shiki theme modules
  ],
});
```

With `@streamdown/react-native`:

```tsx
import { Streamdown } from "@streamdown/react-native";

<Streamdown plugins={{ code }}>{markdown}</Streamdown>;
```
