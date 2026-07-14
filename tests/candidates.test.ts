import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkRepo } from '../src/coremap/walker.js';
import { parseTask } from '../src/coremap/task.js';
import { gatherCandidates } from '../src/coremap/candidates.js';
import type { Candidate } from '../src/coremap/types.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'mini-repo');

function isCandidate(c: unknown): c is Candidate {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.path === 'string' &&
    typeof o.lineStart === 'number' &&
    typeof o.lineEnd === 'number' &&
    typeof o.reason === 'string' &&
    typeof o.scoreHints === 'object'
  );
}

describe('gatherCandidates', () => {
  it('returns non-empty typed candidates for a billing task', async () => {
    const { files, excludedForSecrets } = walkRepo(root);
    expect(files.length).toBeGreaterThan(0);
    expect(excludedForSecrets).toBeGreaterThanOrEqual(1);

    const task = parseTask('fix calculateTotal tax in src/billing.ts');
    const candidates = await gatherCandidates(files, task);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(isCandidate)).toBe(true);

    const paths = new Set(candidates.map((c) => c.path));
    expect([...paths].some((p) => p.includes('billing'))).toBe(true);
  });

  it('skips a corrupt file without aborting', async () => {
    const { files } = walkRepo(root);
    const poisoned = [
      ...files,
      {
        path: 'broken.ts',
        absolutePath: '/tmp/broken.ts',
        // Unbalanced content still should not throw out of gatherCandidates
        content: 'export function oops(\n<<<<<<<',
      },
    ];
    const candidates = await gatherCandidates(poisoned, parseTask('fix oops calculateTotal'));
    expect(Array.isArray(candidates)).toBe(true);
  });
});

void fs;
