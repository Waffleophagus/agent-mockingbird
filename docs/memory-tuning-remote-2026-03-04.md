# Memory Retrieval Tuning (Remote Ollama)

Date: 2026-03-04  
Endpoint: `http://172.16.1.100:11434`

## Test Matrix

| Case | Model | conceptExpansionMaxTerms | semanticRescueMinVectorScore | semanticRescueMaxResults |
|---|---|---:|---:|---:|
| case1 | `qwen3-embedding:4b` | 10 | 0.75 | 2 |
| case2 | `qwen3-embedding:4b` | 12 | 0.72 | 2 |
| case3 | `qwen3-embedding:4b` | 12 | 0.70 | 3 |
| case4 | `granite-embedding:278m` | 10 | 0.75 | 2 |
| case5 | `embeddinggemma:latest` | 10 | 0.75 | 2 |

## Query Set

Adjacent-recall queries:
- `portfolio`
- `how is my portfolio doing`
- `metals exposure`
- `silver price`
- `asset allocation`

Control precision queries:
- `what is my daughter's name`
- `how should I write a Bun script`

Noise probe:
- `favorite color`

## Results

| case | model | adjacent_recall_hits | control_precision_hits | unrelated_noise | average_top_score | runtime_seconds |
|---|---|---:|---:|---:|---:|---:|
| case4 | `granite-embedding:278m` | 5 | 2 | 0 | 0.976600 | 9 |
| case3 | `qwen3-embedding:4b` | 4 | 2 | 1 | 0.972300 | 11 |
| case1 | `qwen3-embedding:4b` | 4 | 2 | 0 | 0.785720 | 11 |
| case2 | `qwen3-embedding:4b` | 4 | 2 | 0 | 0.785580 | 11 |
| case5 | `embeddinggemma:latest` | 4 | 2 | 0 | 0.783700 | 8 |

## Recommendation

Use:
- `runtime.memory.embedModel = "granite-embedding:278m"`
- `runtime.memory.retrieval.conceptExpansionMaxTerms = 10`
- `runtime.memory.retrieval.semanticRescueMinVectorScore = 0.75`
- `runtime.memory.retrieval.semanticRescueMaxResults = 2`

Why:
- Best adjacent recall (5/5)
- No added unrelated noise
- Control queries still correct
- Fastest among high-quality candidates in this run

## Artifacts

- Summary JSON: `/tmp/wb-tune-remote/summary.json`
- Per-case raw outputs: `/tmp/wb-tune-remote/{case}/`
