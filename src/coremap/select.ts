import { createHash } from 'node:crypto';
import type { SelectedSpan, WalkedFile } from './types.js';
import type { RankedCandidate } from './rank.js';
import { countTokens } from './tokens.js';

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function overlaps(
  a: { path: string; lineStart: number; lineEnd: number },
  b: { path: string; lineStart: number; lineEnd: number },
): boolean {
  if (a.path !== b.path) return false;
  return !(a.lineEnd < b.lineStart || b.lineEnd < a.lineStart);
}

/**
 * Select exact source spans until budgetLines is exhausted.
 * Precision-first: highest-ranked non-overlapping windows.
 * Final emit order: sort by rank then path (deterministic).
 */
export function selectSpans(
  ranked: RankedCandidate[],
  files: WalkedFile[],
  budgetLines: number,
): SelectedSpan[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const selected: SelectedSpan[] = [];
  let used = 0;

  for (const cand of ranked) {
    if (used >= budgetLines) break;
    const file = byPath.get(cand.path);
    if (!file) continue;

    const lines = file.content.split(/\r?\n/);
    const start = Math.max(1, cand.lineStart);
    const end = Math.min(lines.length, cand.lineEnd);
    if (start > end) continue;

    if (selected.some((s) => overlaps(s, { path: cand.path, lineStart: start, lineEnd: end }))) {
      continue;
    }

    const remaining = budgetLines - used;
    const spanLines = end - start + 1;
    const takeEnd = spanLines > remaining ? start + remaining - 1 : end;
    const slice = lines.slice(start - 1, takeEnd);
    const text = slice.join('\n');

    selected.push({
      path: cand.path,
      lineStart: start,
      lineEnd: takeEnd,
      reason: cand.reason,
      rank: selected.length + 1,
      tokens: countTokens(text),
      contentHash: contentHash(text),
      lines: slice,
    });

    used += takeEnd - start + 1;
  }

  return [...selected].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.path.localeCompare(b.path);
  });
}

/** Stable identity key for span lists (tests). */
export function spanListKey(spans: SelectedSpan[]): string {
  return spans.map((s) => `${s.rank}|${s.path}|${s.lineStart}-${s.lineEnd}|${s.reason}`).join('\n');
}
