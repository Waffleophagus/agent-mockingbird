# Memory E2E Trace (QMD + sqlite-vec)

Date: 2026-03-04
Repo: `/var/home/matt/Documents/random-vibecoded-stuff/wafflebot`

## Goal
Verify end-to-end memory ingest and retrieval behavior with the family prompt scenario, and inspect debug traces from the current `qmd_hybrid` pipeline.

## Commands Run
```bash
bun run src/backend/memory/cli.ts status
bun run src/backend/memory/cli.ts remember "My wife's name is Tiffany and my daughter is Lucy Lee."
bun run src/backend/memory/cli.ts sync
bun run src/backend/memory/cli.ts status
bun run src/backend/memory/cli.ts search --debug "who is my daughter?"
bun run src/backend/memory/cli.ts search --debug "who is my wife?"
bun run src/backend/memory/cli.ts search --debug "family members relatives spouse children parents siblings"
bun run src/backend/memory/cli.ts search --debug "family"
```

Raw capture file: `/tmp/wafflebot-memory-trace-output.txt`

## Key Results

### 1) Vector backend is active
After sync, memory status showed:
- `vectorBackendConfigured: "sqlite_vec"`
- `vectorBackendActive: "sqlite_vec"`
- `vectorAvailable: true`
- `vectorDims: 2560`
- `vectorIndexedChunks: 2`

### 2) Specific relation queries work
Query: `who is my daughter?`
- Returned memory chunk from `memory/2026-03-04.md#L1`
- Snippet includes: `... my daughter is Lucy Lee.`
- Score: `0.9291`

Query: `who is my wife?`
- Returned same chunk
- Snippet includes: `My wife's name is Tiffany ...`
- Score: `0.9331`

### 3) Broad family queries still fail
Query: `family members relatives spouse children parents siblings`
- `debug.rankedLists` showed multiple vector lists with `count: 2`
- Final `results` was `[]`

Query: `family`
- `debug.rankedLists` also showed vector list counts
- Final `results` was `[]`

## Interpretation
The vector stage appears to retrieve candidates, but they are filtered out later. Likely reasons in current pipeline:
- Lexical gating in final filtering rejects candidates that do not share query tokens (`family`, etc.) even when semantic vector match exists.
- `minScore` threshold can further remove surviving candidates.

Relevant code paths:
- Vector retrieval and fallback: `src/backend/memory/service.ts` (`searchVectorCandidates`)
- Final filtering: `src/backend/memory/service.ts` (`applyFinalFiltering` + lexical signal check)

## Conclusion
The sqlite-vec backend is working and integrated correctly with existing Ollama embeddings. The remaining miss is primarily in post-retrieval filtering behavior for broad category queries like `family`, not vector indexing itself.
