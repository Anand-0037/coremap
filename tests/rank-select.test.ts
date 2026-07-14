import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkRepo } from '../src/coremap/walker.js';
import { parseTask } from '../src/coremap/task.js';
import { gatherCandidates } from '../src/coremap/candidates.js';
import { rankCandidates } from '../src/coremap/rank.js';
import { selectSpans, spanListKey } from '../src/coremap/select.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'mini-repo');

describe('rank + select', () => {
  it('is deterministic across reruns and respects budget', async () => {
    const { files } = walkRepo(root);
    const task = parseTask('fix calculateTotal tax');
    const candidates = await gatherCandidates(files, task);
    const ranked = rankCandidates(candidates, task);

    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[ranked.length - 1]!.score);

    const a = selectSpans(ranked, files, 30);
    const b = selectSpans(ranked, files, 30);

    expect(spanListKey(a)).toBe(spanListKey(b));

    const lines = a.reduce((n, s) => n + (s.lineEnd - s.lineStart + 1), 0);
    expect(lines).toBeLessThanOrEqual(30);
    expect(a.length).toBeGreaterThan(0);

    // Final order: rank then path
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]!;
      const cur = a[i]!;
      expect(prev.rank).toBeLessThanOrEqual(cur.rank);
      if (prev.rank === cur.rank) {
        expect(prev.path.localeCompare(cur.path)).toBeLessThanOrEqual(0);
      }
    }

    const top = ranked.slice(0, 5);
    expect(
      top.some(
        (c) =>
          c.scoreHints.exactMention > 0 ||
          c.reason === 'exact-symbol' ||
          c.reason === 'exact-term' ||
          c.symbolName === 'calculateTotal',
      ),
    ).toBe(true);
  });

  it('byte-identical span lists when whole pipeline rerun', async () => {
    const run = async () => {
      const { files } = walkRepo(root);
      const task = parseTask('fix calculateTotal tax');
      const candidates = await gatherCandidates(files, task);
      return spanListKey(selectSpans(rankCandidates(candidates, task), files, 40));
    };
    expect(await run()).toBe(await run());
  });
});

describe('offline no-api', () => {
  it('completes selection with no OPENAI_API_KEY', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { files } = walkRepo(root);
      const candidates = await gatherCandidates(files, parseTask('fix billing'));
      expect(candidates.length).toBeGreaterThan(0);
      // Prove env truly unset
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

// silence unused in case tree shake
void fs;
