# Streamdown React Native Plan

Last updated: 2026-03-08

## Goal
Ship an Expo-first React Native implementation of Streamdown with strong streaming performance, without WebView.

## Locked Decisions
- V1 scope: streaming markdown + code highlighting first.
- V1 defers full Mermaid and KaTeX parity (render as fenced-code fallback for now).
- Animation backend: require `react-native-reanimated`.
- Syntax highlighting engine: require native `react-native-shiki-engine`.
- Platform approach: Expo-first, but native code (Expo module/dev client) is allowed where needed for performance.

## Status Snapshot
- [x] Architecture and compatibility investigation completed.
- [x] Feature-priority and dependency decisions finalized.
- [x] Monorepo package split and scaffolding implemented.
- [x] RN renderer implementation completed (v1 baseline).
- [x] RN animation path implemented (v1 baseline + token guardrail).
- [x] RN native Shiki path implemented (v1 baseline).
- [ ] RN integration/performance tests completed.
- [ ] Documentation and migration notes completed.

## Phased Steps

### Phase 0: Investigation and Direction
Status: Completed
- [x] Audit web-only coupling in current `streamdown` package.
- [x] Identify reusable core logic (`remend`, block parsing, streaming/memoization behavior).
- [x] Lock v1 scope and dependency choices.

### Phase 1: Package Structure
Status: Completed
- [x] Add new package `@streamdown/react-native`.
- [x] Introduce a shared core boundary (`@streamdown/core` or equivalent internal module split).
- [x] Keep existing web package behavior stable (`streamdown` remains web renderer).
- [x] Define native package exports and peer dependencies.
- [x] Verify build after installing workspace dependencies.

### Phase 2: RN Rendering Pipeline
Status: Completed (v1 baseline)
- [x] Replace web HAST->JSX path with RN element mapping (baseline implementation).
- [x] Implement tag/component mappings for common markdown elements (headings, paragraph, lists, links, images, code, tables baseline).
- [x] Preserve streaming block memoization and key stability behavior (baseline block renderer).
- [x] Implement link open behavior with RN-compatible primitives (`Linking` + overridable handler).
- [x] Add native image rendering baseline + fallback text on load error.
- [x] Add compatibility options baseline (`allowElement`, `allowedElements`, `disallowedElements`, `unwrapDisallowed`, `urlTransform`).
- [x] Add initial RN package tests.
- [ ] Expand tests to interaction/perf-level coverage (pending).

### Phase 3: RN Animations (Reanimated Required)
Status: Completed (v1 baseline)
- [x] Build native text-run animation path for newly mounted streaming tokens.
- [x] Map current animation modes to RN equivalents:
- [x] `fadeIn` native implementation.
- [x] `slideUp` native implementation.
- [x] `blurIn` fallback behavior (currently degrades to fade).
- [x] Add animation budget guardrails to avoid token-mount jank on large updates (`maxAnimatedTokens`).

### Phase 4: RN Code Highlighting (Native Engine Required)
Status: Completed (v1 baseline)
- [x] Implement code plugin adapter using `@shikijs/core` + `react-native-shiki-engine`.
- [x] Initialize highlighter as singleton and keep token cache behavior.
- [x] Define fail-fast error path when native engine is unavailable.
- [x] Integrate highlighted token rendering into RN code block components.

### Phase 5: Deferred Features (V1 Fallbacks)
Status: Pending
- [ ] Mermaid fences render as code blocks in v1.
- [ ] Math fences/inline render as plain markdown/code fallback in v1.
- [ ] Add explicit extension hooks for future native Mermaid/Math support.

### Phase 6: Testing and Validation
Status: In Progress
- [x] Unit tests for shared parsing/termination behavior.
- [x] Baseline tests for RN parsing + animation tokenization internals.
- [x] Baseline tests for RN filtering compatibility helpers (`allowedElements`, `disallowedElements`, `allowElement` logic path).
- [x] Code-native unit tests for caching/subscription/native-engine handling.
- [x] Code-native unit test for highlight failure-path behavior.
- [ ] RN renderer tests for markdown element mapping and streaming re-render boundaries.
- [ ] RN integration tests for code highlighting and link handling in a real RN runtime.
- [ ] Performance validation on long streaming responses.

### Phase 7: Docs and Release
Status: Pending
- [ ] Add RN usage docs (Expo setup, native engine setup, Reanimated requirement).
- [ ] Add V1 feature matrix (supported vs deferred).
- [ ] Add migration guidance for existing `streamdown` users targeting RN.

## Context To Preserve For Future Sessions

### Product/Scope Context
- No WebView approach.
- V1 prioritizes chat streaming UX and code readability over full plugin parity.
- Mermaid/Math are intentionally deferred for v1 parity.

### Technical Constraints
- Existing web implementation is tightly coupled to DOM/CSS/HTML intrinsic elements.
- Native implementation must avoid `react-dom`, DOM APIs, and CSS animation assumptions.
- Reanimated and native Shiki engine are required dependencies in the current plan.

### Key Areas In Current Codebase
- Streaming orchestration and memoization: `packages/streamdown/index.tsx`
- Markdown processor/HAST rendering path: `packages/streamdown/lib/markdown.ts`
- Web component mappings and interactive controls: `packages/streamdown/lib/components.tsx`
- Animation transformer: `packages/streamdown/lib/animate.ts`
- Block parser and streaming chunk behavior: `packages/streamdown/lib/parse-blocks.tsx`
- Markdown termination logic: `packages/remend/src/index.ts`
- Current code plugin (web): `packages/streamdown-code/index.ts`

### External Dependencies To Revisit During Implementation
- `react-native-reanimated` integration details and perf tuning.
- `react-native-shiki-engine` + `@shikijs/core` native setup and Expo compatibility.

## Done Criteria For V1
- RN package renders streaming markdown and highlighted code with acceptable performance in an Expo app.
- Reanimated token reveal is functional and stable under streaming load.
- Native Shiki highlighting is working end-to-end.
- Deferred features are clearly documented and fail gracefully.
