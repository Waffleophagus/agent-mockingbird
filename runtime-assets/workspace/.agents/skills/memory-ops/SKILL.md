---
name: memory-ops
description: Use Wafflebot memory effectively for persistent context across sessions.
---

# memory-ops

Use Wafflebot memory effectively for persistent context across sessions.

## Memory Tools

| Tool | Purpose |
|------|---------|
| `memory_search` | Find relevant prior context by semantic query |
| `memory_get` | Read specific memory file by path |
| `memory_remember` | Persist a durable fact, decision, or context |

## Workflow

### 1. Always Search First

Before making decisions or asking clarifying questions, search memory:

```
memory_search(query="project architecture decisions", maxResults=5)
memory_search(query="user preferences for tests", maxResults=3)
```

Use semantically specific queries first, then broaden carefully. Current runtime defaults are `maxResults=4` and `minScore=0.35`.

#### Query steering (important)

- Prefer concrete entities over vague categories.
- Include relationship terms the memory likely contains.
- Try 2-4 reformulations before concluding "not found".

Examples:

```
# weak (often misses lexical filter)
memory_search(query="family")

# stronger
memory_search(query="daughter name")
memory_search(query="Lucy Lee")
memory_search(query="wife Tiffany")
memory_search(query="who is my daughter Lucy")
```

If zero results:

1. Retry with exact names (`Lucy Lee`, `Tiffany`).
2. Retry with relation words (`daughter`, `wife`, `spouse`, `child`).
3. Lower threshold once (`minScore=0.2`) for recall probe.
4. If still empty, confirm memory was actually written and indexed.

### 2. Validate with Get

Memory files live in `MEMORY.md` or `memory/*.md`. Use `memory_get` to read full context around a snippet:

```
memory_get(path="memory/decisions.md", from=1, lines=50)
```

### 3. Persist What Matters

Use `memory_remember` for durable information that should survive session boundaries:

**Good candidates:**
- Project-level decisions and rationale
- User preferences and constraints
- Recurring patterns or conventions discovered
- Critical context about third-party integrations

**Parameters:**

| Param | Purpose | Example |
|-------|---------|---------|
| `content` | The fact/decision to remember | "Use Bun, not Node.js" |
| `topic` | Category for organization | "conventions", "decisions" |
| `entities` | Related identifiers | ["bun", "runtime"] |
| `confidence` | Certainty level 0-1 | 0.9 for verified facts |
| `source` | Who provided this | "user", "assistant", "system" |
| `supersedes` | IDs of outdated memories to replace | ["mem_abc123"] |

### 4. Supersede, Don't Duplicate

When information changes, include `supersedes` to link the replacement:

```
memory_remember(
  content="Testing framework: bun test (switched from vitest)",
  topic="conventions",
  supersedes=["mem_old_testing_config"]
)
```

## Memory Modes

Runtime config `runtime.memory.toolMode` controls behavior:

| Mode | Behavior |
|------|----------|
| `hybrid` | Prompt context + tools available |
| `inject_only` | Prompt context only, tools disabled |
| `tool_only` | Tools only, no prompt injection (default) |

Adjust usage accordingly — in `inject_only`, rely on existing memories in prompt context.

## Anti-Patterns

- **Don't** use only abstract terms like "family", "personal", "life" as first query
- **Don't** memorize ephemeral state (current task progress, temp files)
- **Don't** write memories for information already in code/docs
- **Don't** create redundant memories — search first, then supersede
- **Don't** use low confidence (<0.5) for critical decisions
