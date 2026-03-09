# @streamdown/react-native

React Native renderer package for Streamdown.

Status: v1 baseline renderer implemented.

Current exports:
- `Streamdown` (streaming block orchestration + baseline RN markdown renderer)
- `remend`
- `parseMarkdownIntoBlocks`

Implemented in baseline:
- Streaming block splitting and incremental updates
- RN-native rendering for common markdown elements
- Link handling via React Native `Linking` (or custom `onLinkPress`)
- Reanimated token animation (`fadeIn`, `slideUp`, `blurIn` fallback)
- Animation guardrail via `animated.maxAnimatedTokens`
- Optional native code highlighting plugin hook (`plugins.code`)

## Install (pnpm)

```bash
pnpm add @streamdown/react-native react-native-reanimated@~4.0.1 react-native-worklets@0.5.1 react-native-url-polyfill
```

Optional native code highlighting plugin:

```bash
pnpm add @streamdown/code-native @shikijs/core react-native-shiki-engine
```

## Basic usage

```tsx
import { Streamdown } from "@streamdown/react-native";

export function ChatMessage({ text }: { text: string }) {
  return (
    <Streamdown animated={{ animation: "fadeIn", sep: "word" }}>
      {text}
    </Streamdown>
  );
}
```

## Animation options

`animated` accepts:
- `animation`: `"fadeIn" | "slideUp" | "blurIn"` (`blurIn` currently degrades to fade)
- `duration`: number (ms)
- `easing`: `"linear" | "ease-in" | "ease-out" | "ease-in-out"`
- `sep`: `"word" | "char"`
- `maxAnimatedTokens`: number (default `400`)

Planned implementation phases are tracked in `/plan.md`.
