# CoreMap Tasks

Atomic v0.1 tasks. Each maps to a requirement and has a definition of done.

Status legend: **done** items shipped in the current tree; keep this file as the contract for regressions.

## T1 — Types + CLI flags (R1, R9) — done

- **Do:** `src/coremap/types.ts`, `src/cli.ts` with pack + task flags.
- **Done when:** `npm test` passes flag parse; `npm run coremap -- --help` shows flags.
- **Do not:** regress pack/task flag parsing.

## T2 — Walker + secrets (R10, R12) — done

- **Do:** `walker.ts`, `secrets.ts`. gitignore + `.coremapignore`; path and content secret scan.
- **Done when:** leaked-key fixtures excluded; walk continues on parse failures.

## T3 — Pack mode (R2) — done

- **Do:** `tree.ts`, `pack.ts`, `run.ts` pack branch. Real o200k tokens; `--max-tokens`, `--out-file`.
- **Done when:** `npm run pack` / pack tests write a usable tree + file pack.

## T4 — Candidates (R3, R10) — done

- **Do:** `candidates.ts` (+ `task.ts`, `parser.ts`). Terms, symbols, imports, tests, entry bias.
- **Done when:** vitest on `fixtures/mini-repo` asserts non-empty typed `Candidate[]`.

## T5 — Rank + select (R4, R13) — done

- **Do:** `rank.ts`, `select.ts`. Deterministic order: exact > lexical > import-neighbor > centrality.
- **Done when:** two consecutive runs produce identical span lists; budget respected.

## T6 — Receipt emit (R5, R6, R13) — done

- **Do:** `receipt.ts` writes `coremap-context.md` + `coremap-receipt.json`.
- **Done when:** schema matches `spec.md`; persisted timing fields are stable.

## T7 — Verify + report (R7, R8, R9) — done

- **Do:** `verify.ts` (lazy OpenAI) + `report.ts`. Offline path + optional oracle with `--ground-truth`.
- **Done when:** `--no-llm` never throws; table prints; LLM is optionalDependency.

## T8 — HitFile / HitRegion (R11) — done

- **Do:** `hits.ts` + `--ground-truth`. Scores in receipt only; patch never feeds selection.
- **Done when:** tax-bug fixture reports HitFile / HitRegion≈ in `[0,1]`.

## T9 — Demo vertical slice — done

- **Do:** `npm run demo` on `fixtures/eval-tax-bug`; README usage + GREEN DELTA framing.
- **Done when:** one command produces pack + receipt + table with tests PASS.

## T10 — Publish surface — done (local); publish is manual

- **Do:** package `coremap`, `prepublishOnly`, `bin/`, clean `files` allowlist.
- **Done when:** `npm publish --dry-run` ships `bin` + `dist` + `LICENSE` + `README.md` only.
- **Do not:** auto-publish from agents.
