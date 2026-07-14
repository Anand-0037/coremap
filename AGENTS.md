# CoreMap — Agent Constitution

You are building **CoreMap**: a CLI that packs a repository for agents, or — with `--task` — compiles the **smallest sufficient evidence** for one job plus a verification receipt.

## Product rule

```
npx coremap ./repo
→ coremap.md (tree + full files + summary)

npx coremap ./repo --task "<issue>" --budget-lines 200 [--verify] [--no-llm]
→ ranked exact spans → coremap-context.md + coremap-receipt.json → optional patch + tests
```

Lead with **verified context + receipt**. Pack mode is the on-ramp; task mode is the wedge.

## Hard constraints (non-negotiable)

1. **Deterministic output** — Sort spans by rank then path. No wall-clock in emitted files. Reruns must be byte-identical for the same inputs.
2. **Offline mode** — If `OPENAI_API_KEY` is missing or `--no-llm` is set: run selection + receipt, skip the patch step with a clear message. Never dump a stack trace for missing keys.
3. **Resilience** — Parse failure ⇒ log + skip that file; never abort the run (R9).
4. **Exact spans** — Emit path + line range with real source lines. Never signatures/summaries alone.
5. **Precision over recall** — Prefer fewer decisive lines over dumping neighbors.
6. **Secrets** — Exclude by path (`**/.env*`) AND content scan. Never emit secret contents.
7. **Strict TypeScript** — No `any` without a comment. Small pure functions. One vitest smoke test per module.
8. **Own brand only** — Public docs and CLI speak as CoreMap. No competitor product names in the pitch surface.

## Module map (`src/coremap/`)

| File | Job |
|------|-----|
| `types.ts` | Shared types — import from here only |
| `task.ts` | Parse `--task` → terms, symbols, paths |
| `walker.ts` | gitignore-aware walk (+ `.coremapignore`, secrets) |
| `candidates.ts` / `rank.ts` / `select.ts` | Task-mode evidence pipeline |
| `pack.ts` / `tree.ts` | Pack-mode full ingest |
| `receipt.ts` / `verify.ts` / `report.ts` | Receipt + optional verify + table |
| `parser.ts` / `tokens.ts` / `secrets.ts` | Parse, tokenize, secret scan |

## Out of scope today

Embeddings, MCP server, multi-language tree-sitter beyond TS/JS, autonomous learning, cross-repo indexing.

## Demo success metric

On a pinned known-issue repo: meaningful token reduction **and** HitFile≈1.0 with tests PASS under `--verify`, proven by the receipt table.
