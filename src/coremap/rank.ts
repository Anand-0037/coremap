import type { Candidate, ParsedTask, SelectionReason } from './types.js';

/** Reason tiers: exact path/symbol > lexical > import-neighbor > centrality/entrypoint. */
const REASON_TIER: Record<SelectionReason, number> = {
  'exact-symbol': 5,
  'exact-path': 5,
  'exact-term': 4,
  lexical: 3,
  'symbol-signature': 3,
  'import-neighbor': 2,
  'reverse-import': 2,
  'nearby-test': 2,
  entrypoint: 1,
  config: 1,
};

/**
 * Composite score: exact mention >> lexical >> import neighbor >> centrality.
 * Reason tier breaks ties before path sort.
 */
export function scoreCandidate(c: Candidate, _task: ParsedTask): number {
  const h = c.scoreHints;
  const tier = REASON_TIER[c.reason] ?? 0;
  return (
    h.exactMention * 1_000_000 +
    tier * 100_000 +
    h.lexical * 1_000 +
    h.importNeighbor * 100 +
    h.centrality
  );
}

export interface RankedCandidate extends Candidate {
  score: number;
}

/**
 * Rank candidates precision-first.
 * Deterministic: score desc, then path, then lines, then reason.
 */
export function rankCandidates(candidates: Candidate[], task: ParsedTask): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map((c) => ({
    ...c,
    score: scoreCandidate(c, task),
  }));

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
    if (a.lineEnd !== b.lineEnd) return a.lineEnd - b.lineEnd;
    return a.reason.localeCompare(b.reason);
  });

  return ranked;
}
