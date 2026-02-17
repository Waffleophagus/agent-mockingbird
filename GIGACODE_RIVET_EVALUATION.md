# Gigacode + Sandbox Agent + Rivet Evaluation

Analysis date: `2026-02-16`

## Context

Goal: build an open-source, smaller-scope "OpenClaw but less bloat" system with:

- OpenCode-style usability
- strong resiliency/reconnect behavior
- single-machine bootstrap (cloud-init/ignition) as a first-class deployment target
- no immediate need for hyperscale SaaS orchestration

This evaluation focuses on docs + TypeScript-facing surfaces (not Rust internals).

## TL;DR

- **Gigacode/Sandbox Agent is useful** as a compatibility bridge if you want OpenCode UI + Codex/Claude harnesses.
- **Rivet Engine is likely overkill right now** for your current scope.
- **Recommended stance**:
  - use OpenCode-native runtime as primary
  - optionally add Sandbox Agent as a secondary runtime adapter (for Codex/Claude harness parity)
  - defer full Rivet adoption until you need multi-tenant actor orchestration at scale

## Quick answers

## Is Ollama GGUF-based?

Yes for local model runtime in practice. Ollama serves GGUF-backed local models, while exposing OpenAI-compatible APIs.

## Is Gigacode "real" or just a thin wrapper?

It is thin by design.

- `gigacode` sets `gigacode: true` and defaults to the `opencode` command path:
  - `sandbox-agent/gigacode/src/main.rs:13`
  - `sandbox-agent/gigacode/src/main.rs:18`
  - `sandbox-agent/gigacode/src/main.rs:21`

So the value is mostly in the Sandbox Agent compatibility layer + packaged UX, not a separate runtime core.

## What Gigacode/Sandbox Agent gives you

- Universal API over multiple coding-agent harnesses (Codex/Claude/OpenCode/etc):
  - `sandbox-agent/README.md:33`
- OpenCode compatibility path so OpenCode clients can attach:
  - `sandbox-agent/docs/opencode-compatibility.mdx:10`
  - `sandbox-agent/docs/opencode-compatibility.mdx:14`
- Explicit positioning for OpenCode TUI with other harnesses:
  - `sandbox-agent/README.md:16`
  - `sandbox-agent/gigacode/README.md:19`

This aligns with your statement that Codex harness quality can be better than OpenCode’s native tool loop for some workloads.

## Important limitations (today)

## OpenCode compatibility is explicitly experimental

- `sandbox-agent/docs/opencode-compatibility.mdx:7`
- `sandbox-agent/README.md:38`

## Endpoint coverage is partial/stubbed

Compatibility docs mark several endpoints as proxied/stubbed:

- `sandbox-agent/docs/opencode-compatibility.mdx:114`
- `sandbox-agent/docs/opencode-compatibility.mdx:120`
- `sandbox-agent/docs/opencode-compatibility.mdx:121`

Implication: good enough for core chat/session flows, but not full parity with native OpenCode server behavior.

## Session durability is not built in

Sessions are in-memory by default and must be persisted externally:

- `sandbox-agent/docs/manage-sessions.mdx:7`

This is compatible with your architecture direction (you already plan your own durable store), but it means you still own resilience logic.

## Event normalization can lose detail depending on agent

Docs note uneven normalized coverage and agent-specific gaps:

- `sandbox-agent/docs/session-transcript-schema.mdx:16`
- `sandbox-agent/docs/session-transcript-schema.mdx:26`
- `sandbox-agent/server/ARCHITECTURE.md:375`

Implication: if your UI depends on deep tool/reasoning deltas, test Codex/Claude behavior carefully.

## Sandbox Agent persistence packages are Node-centric

The SQLite persistence driver uses `better-sqlite3`:

- `sandbox-agent/sdks/persist-sqlite/package.json:20`
- `sandbox-agent/sdks/persist-sqlite/src/index.ts:1`

This is fine in Node; in Bun it may require extra care around native module compatibility.

## Rivet fit for your project

## What Rivet is good at

- Durable actor state + scheduling + queues out of the box:
  - `rivet/website/src/content/docs/actors/schedule.mdx:7`
  - `rivet/website/src/content/docs/actors/queue.mdx` (reviewed)
- Strong TypeScript-first actor API:
  - `rivet/README.md:22`
  - `rivet/README.md:54`
- Can run self-hosted with file-system backend on single-node:
  - `rivet/website/src/content/docs/self-hosting/filesystem.mdx:3`
  - `rivet/website/src/content/docs/self-hosting/filesystem.mdx:45`

## Why it can feel like a battleship for your case

- Self-hosting docs explicitly call out higher complexity/full-stack ownership:
  - `rivet/website/src/content/docs/self-hosting/index.mdx:20`
  - `rivet/website/src/content/docs/self-hosting/index.mdx:21`
- Runtime model assumes Rivet Engine orchestration for many production paths:
  - `rivet/website/src/content/docs/general/runtime-modes.mdx:59`
  - `rivet/website/src/content/docs/general/runtime-modes.mdx:105`
- Package/runtime surface is broad and opinionated (great power, higher integration tax):
  - `rivet/rivetkit-typescript/packages/rivetkit/package.json:187`
  - `rivet/rivetkit-typescript/packages/rivetkit/package.json:209`

Inference: Rivet is excellent infrastructure if you want actor-native architecture as your foundation. For your current "tight scope + single machine + minimal bloat" phase, it is probably more platform than you need.

## Recommendation for your roadmap

## 1) Use Sandbox Agent as an optional runtime adapter, not your core platform

Keep your existing plan:

- OpenCode-centric orchestrator + SQLite + your own scheduler/memory

Add Sandbox Agent as:

- `RuntimeAdapter: "sandbox-agent"` for cases where you explicitly want Codex/Claude native harness behavior behind OpenCode UI.

## 2) Do not adopt full Rivet Engine now

Revisit only if you hit one of these:

- many concurrently active workspaces/users
- strong need for actor-level sharding/routing managed for you
- desire to trade custom orchestration code for platform coupling

## 3) If you want one Rivet piece now, evaluate narrowly

Potentially evaluate `@rivetkit/workflow-engine` as a standalone durable-workflow primitive (custom driver), but only if it replaces enough custom scheduler complexity to justify added abstraction.

## Practical next experiment (low risk)

1. Run Sandbox Agent + OpenCode attach in your dev box.
2. Execute the same benchmark task through:
   - native OpenCode runtime
   - Sandbox Agent + Codex harness (via `/opencode`)
3. Compare:
   - event fidelity in your UI
   - permission/question behavior
   - reconnect/resume behavior
   - total ops complexity
4. Keep it only if it materially improves output quality without adding fragile edge cases.

## Source snapshot

- `sandbox-agent` commit reviewed: `8a78e06` (2026-02-13 UTC)
- `rivet` commit reviewed: `a310560f5` (2026-02-16 UTC)

