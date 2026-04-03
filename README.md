# <div align="center"><img src="./agent-mockingbird-logo-4k-transparent-with-holes-punched2.png" alt="Agent Mockingbird logo" width="220" /></div>

# Agent Mockingbird

> ⚠️ **WARNING: Not Production Ready**
> This project is currently in early development and is **not quite ready** for general use. It may receive **breaking changes** at any time as we iterate on the design and architecture. Use at your own risk!

Agent Mockingbird is a personal assistant built around OpenCode. It gives you a long-running local agent with persistent memory, scheduled jobs, workspace bootstrap context, and a web API/UI layer for managing runs and configuration.

As OpenClaw is to Pi, the goal is that Agent Mockingbird will be to OpenCode.

## What It Is

Agent Mockingbird sits between your workspace and OpenCode:

- it stores runtime config locally
- it forwards prompts and run events through an OpenCode-backed runtime
- it adds memory tools and retrieval over your workspace data
- it runs scheduled agent jobs with a cron-style execution system
- it injects OpenClaw-style workspace context files such as `AGENTS.md`, `TOOLS.md`, and `IDENTITY.md`

The result is a personal agent stack you can keep running locally instead of a one-shot CLI session.

## Why this over OpenClaw?

In short, control by the human. Openclaw gives the machine everything, which has pros and cons. The pros are it can do anything you can on the machine. The cons means that often times it makes the same mistakes and can break things. The goal of Agent Mockingbird is to tighten the scope using Opencode's first-in-class agent management, limiting it to a specific workspace, and limiting what commands it can call out of the gate to limit blast radius of mistakes.

## Highlights

- OpenCode-backed runtime with local run tracking and event streaming
- Persistent memory APIs and tools for retrieval, recall, and note storage
- Cron job management for recurring or conditional agent work
- Managed OpenCode config and plugin wiring
- Workspace bootstrap context from markdown files in the bound workspace
- Local API surface for config, runs, memory, heartbeat, cron, agents, and UI routes

## Quick Start

Recommended install flow for end users on Linux:

```bash
bun install -g agent-mockingbird
agent-mockingbird install
```

The npm/Bun global `agent-mockingbird` command is a bootstrap wrapper. On first install it creates the managed runtime under `~/.agent-mockingbird`, then future `agent-mockingbird` commands delegate into that managed install regardless of npm global prefix or PATH ordering.

`agent-mockingbird install` provisions and starts the `executor` and `agent-mockingbird` user services, then launches the interactive onboarding wizard on TTY installs.

If you are working from source:

```bash
bun install
bun run dev:stack
```

`bun run dev:stack` builds the bundled app, starts the local Executor sidecar on `127.0.0.1:8788`, and starts the Agent Mockingbird server with embedded OpenCode on `127.0.0.1:3001` in one command.

## How It Works

Agent Mockingbird is structured in three layers:

**1. OpenCode Plugin Layer**
An OpenCode plugin (`agent-mockingbird.ts`) that extends the runtime with local orchestration capabilities:

- Memory tools (search, get, remember) for persistent context across sessions
- Cron manager for scheduling and inspecting recurring agent work
- Agent type manager for OpenCode agent definitions
- Config manager for runtime configuration
- Hooks that inject workspace context and thread policies into system prompts
- Shell environment setup for tool communication

**2. UI Patch Layer**
A series of patches applied to the OpenCode UI that add management interfaces:

- Settings panels for Agents, MCP, Skills, Runtime, Cron, and Heartbeat
- Navigation enhancements for the Agent Mockingbird dashboard
- These patches are tracked in `patches/opencode/` and applied via the vendor workflow

**3. Local Server**
A Bun-native server that bridges the plugin and UI layers:

- Provides HTTP APIs for plugin tool execution
- Serves the embedded OpenCode runtime and patched web interface
- Manages local state, memory indexing, cron scheduling, and run tracking

## Core Concepts

### Runtime

Runtime configuration is stored in JSON at `./data/agent-mockingbird.config.json` by default. Agent Mockingbird validates config changes before persisting them and uses that config to drive provider, model, directory, timeout, and runtime behavior.

### Memory

Memory is enabled by default and can index workspace content, store notes, and expose retrieval tools to the runtime. The operator references live in:

- `docs/memory-ops.md`
- `docs/memory-runtime-contract.md`

### Cron

Cron jobs can enqueue recurring or conditional agent work. The cron API supports job creation, updates, execution, instance inspection, and health checks.

### Workspace Bootstrap

Agent Mockingbird can inject workspace markdown context files into runtime system prompts using files such as:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

## FAQ

<details>
<summary><b>Isn't your UI just Opencode's UI with some patches to <em>remove</em> things?</b></summary>

Yes! I'm not gonna lie, I suck at UI and Opencode's webUI is kinda awesome. My thought process is that Opencode is made for developers though, and Agent Mockingbird is designed for everyone. So my goal is to remove things that won't be super useful for non-developers. There's a roadmap item (in my brain) to enable all the Opencode functionality back again.

</details>

<details>
<summary><b>Aren't you just taking multiple projects and shoving them together and calling it something special?</b></summary>

Yep!

</details>

<details>
<summary><b>The way you're doing patches is insanely dumb.</b></summary>

Not really a question... but I wanted to see how this would work. My thought process is this, in the long run, will be easier to maintain the integrated solutions. I could be wrong and give up on this process next week, but for now it's working.

</details>

## Development

For local development:

```bash
bun install
bun run dev:stack
```

Useful commands:

```bash
bun run test
bun run lint
bun run typecheck
bun run build
bun run check:ci
bun run check:ship
```

OpenCode source workflow:

```bash
bun run opencode:sync --status
bun run opencode:sync --rebuild-only
bun run opencode:sync --check
```

The repo treats `cleanroom/opencode` as a pristine upstream clone, `vendor/opencode` as the editable worktree, and `patches/opencode/*.patch` as the tracked patch stack.

Executor source workflow:

```bash
bun run executor:sync --status
bun run executor:sync --rebuild-only
bun run executor:sync --check
bun run executor:sync --ref vX.Y.Z
```

The repo treats `cleanroom/executor` as a pristine upstream clone, `vendor/executor` as the editable worktree, and `patches/executor/*.patch` as the tracked patch stack.

## Docs And References

- `docs/memory-ops.md`
- `docs/memory-runtime-contract.md`
- `docs/vendor-executor.md`
- `docs/vendor-opencode.md`
- `docs/opencode-rebase-workflow-plan.md`
- `docs/opencode-startup-sync-plan.md`
- `packages/agent-mockingbird-installer/README.md`
