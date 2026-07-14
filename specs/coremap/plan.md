# CoreMap Plan

## Product shape

```
coremap <path>                    → pack mode  → coremap.md
coremap <path> --task "…" […]     → task mode  → context + receipt [+ verify]
```

## Architecture

### Pack mode

```
repo path + --max-tokens + --out-file
  → walker (gitignore + .coremapignore + secrets)
  → tree.render + pack.packRepo
  → write out-file
```

### Task mode

```
repo path + --task + --budget-lines
  → walker
  → task.parseTask(task)
  → candidates.gatherCandidates(files, task)
  → rank.rankCandidates(candidates, task)
  → select.selectSpans(ranked, budgetLines)
  → receipt.writePack + writeReceipt
  → [optional] verify + report table
```

## Module breakdown

| Module | Responsibility | Inputs | Outputs |
|--------|----------------|--------|---------|
| `types.ts` | Shared shapes | — | `Candidate`, `SelectedSpan`, `Receipt`, `CliOptions`, … |
| `task.ts` | Lexical parse of `--task` | string | `ParsedTask` |
| `walker.ts` | Collect text files under ignore + secret rules | root path | `WalkedFile[]` |
| `tree.ts` | Directory tree for pack header | walked files | markdown tree |
| `pack.ts` | Full-repo ingest | files + budgets | pack markdown |
| `candidates.ts` | Evidence gathering | files + task | `Candidate[]` |
| `rank.ts` | Score + sort | candidates + task | ranked `Candidate[]` |
| `select.ts` | Budget cut with exact line ranges | ranked + budget | `SelectedSpan[]` |
| `receipt.ts` | Emit pack + JSON | spans + meta | files on disk |
| `verify.ts` | One patch + tests (LLM lazy / oracle) | pack + flags | verify block |
| `report.ts` | Print comparison table | receipt | stdout |
| `hits.ts` | HitFile / HitRegion≈ vs ground-truth | spans + patch | scores |
| `parser.ts` | tree-sitter TS/JS (shared Parser, WASM resolve) | source | symbols / AST helpers |
| `tokens.ts` | js-tiktoken o200k counts | text | token ints |
| `secrets.ts` | Path + content secret scan | path/text | exclude? |
| `run.ts` | Orchestrate pack vs task | `CliOptions` | side effects |
| `cli.ts` | Commander entry + bin | argv | exit code |

## Data shapes (summary)

```ts
Candidate {
  path: string;
  lineStart: number;
  lineEnd: number;
  reason: SelectionReason;
  scoreHints: { exactMention, lexical, importNeighbor, centrality };
  symbolName?: string;
  contentPreview?: string;
}

SelectedSpan {
  path, lineStart, lineEnd, reason, rank, tokens, contentHash, lines
}

Receipt {
  task, budgetLines, tokensUsed, filesSelected, filesRejected,
  excludedForSecrets, retrievalMs,   // retrievalMs forced 0 when persisted
  spans: SelectedSpan[],
  verify?: { patchProduced, testsPassed, tokens, ms },
  baseline?: { tokens, testsPassed },
  hitFile?: number, hitRegion?: number
}
```

## Encoding

Shipped format is Markdown (+ JSON receipt in task mode). Pluggable encoders are out of scope for v0.1.

## npm surface

- Package name: `coremap`
- Bin: `coremap` → `bin/coremap` → `dist/cli.js`
- Library: `import { … } from 'coremap'` via `src/index.ts` / `dist/index.js`
