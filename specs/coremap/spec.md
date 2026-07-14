# CoreMap Spec

## Problem

Coding agents often ingest an entire repository to fix one bug. That wastes tokens and buries the decisive lines. CoreMap offers two paths:

1. **Pack** — one AI-friendly file for the whole repo (tree + sources + summary).
2. **Task** — the smallest set of exact source spans for one job, plus a verification receipt.

## One-liner

CoreMap packs a repo for AI — or, with `--task`, keeps only the lines that matter and can prove they were enough.

## Modes

| Mode | Trigger | Primary outputs |
|------|---------|-----------------|
| Pack | no `--task` | `--out-file` (default `coremap.md`) |
| Task | `--task <text>` | `coremap-context.md` + `coremap-receipt.json` |

## Requirements (EARS)

| ID | Requirement |
|----|-------------|
| **R1** | The system shall accept a repo path and optional flags: `--task`, `--budget-lines`, `--verify`, `--no-llm`, `--ground-truth`, `--max-tokens`, `--out-file`, `--out-dir`. |
| **R2** | When `--task` is absent, the system shall pack the walked repo into one file: directory tree, included sources, and a summary with real token counts. |
| **R3** | When `--task` is set, the system shall build candidates from issue terms, symbol signatures (TS/JS), imports/reverse-imports, nearby tests, and entrypoint/config bias. |
| **R4** | When candidates are ranked, the system shall select exact source spans until the line budget is reached, preferring precision over recall. |
| **R5** | In task mode the system shall emit `coremap-context.md` and `coremap-receipt.json`. |
| **R6** | For each selected span the receipt shall record content hash, path, line range, selection reason, rank, and token/line cost. |
| **R7** | Where `--verify` is set, the system shall attempt one patch (LLM if allowed; oracle if `--ground-truth` + `--no-llm`), run tests, and record pass/fail. |
| **R8** | When `--verify` completes, the system shall print a baseline-vs-CoreMap table (context tokens, HitFile / HitRegion≈ when available, patch produced, tests). |
| **R9** | While no `OPENAI_API_KEY` is set (or `--no-llm`), the system shall run pack/selection offline and skip LLM patch with a clear message. |
| **R10** | If a file fails to parse, the system shall log and skip it and continue without aborting. |
| **R11** | If a ground-truth patch is provided for eval, the system shall compute HitFile and HitRegion≈ against selected spans. The patch must never be an input to selection. |
| **R12** | The system shall exclude secrets by path and by content scan; secret contents shall never appear in emitted packs. |
| **R13** | Emitted receipts shall be deterministic for the same inputs (stable ordering; no wall-clock fields in persisted JSON). |

## Acceptance criteria

- CLI parses pack and task flags (R1).
- Pack mode produces a non-empty tree + file sections (R2).
- Same task inputs → identical span list and receipt body hashes (R13).
- Fixture mini-repo yields non-empty typed candidates (R3).
- Ranking prefers exact path/symbol mentions over weak lexical hits (R4).
- Selection stops at or under `--budget-lines` (R4).
- Offline run never crashes for missing API key (R9).
- Parse errors do not abort the walk (R10).
- Secret-like fixtures are excluded from packs (R12).

## Out of scope (v0.1)

- Embedding / vector indexes
- MCP server
- Symbol extraction beyond TypeScript/JavaScript
- Multi-agent adapters / IDE plugins
- Alternate pack codecs as the default (Markdown is the shipped format)

## Success metric (demo)

On the pinned tax-bug eval: meaningful token reduction vs full dump **and** HitFile = 1.0 with tests PASS under `--verify`, shown in the receipt table (`GREEN DELTA`).
