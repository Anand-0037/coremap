import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeHitMetrics, loadGroundTruth, parseGroundTruthPatch } from '../src/coremap/hits.js';
import { walkRepo } from '../src/coremap/walker.js';
import { parseTask } from '../src/coremap/task.js';
import { gatherCandidates } from '../src/coremap/candidates.js';
import { rankCandidates } from '../src/coremap/rank.js';
import { selectSpans } from '../src/coremap/select.js';
import { applyUnifiedDiff } from '../src/coremap/verify.js';
import { parseSymbols } from '../src/coremap/parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', 'fixtures', 'eval-tax-bug');
const issuePath = path.join(here, '..', 'evals', 'tax-bug', 'issue.txt');
const patchPath = path.join(here, '..', 'evals', 'tax-bug', 'ground-truth.patch');

describe('HitFile / HitRegion eval fixture', () => {
  it('selects from issue text only and hits the known patch region', async () => {
    const issue = fs.readFileSync(issuePath, 'utf8');
    // Ground truth must NOT appear in task / walk inputs
    expect(issue.includes('return addTax')).toBe(false);

    const truth = loadGroundTruth(patchPath);
    expect(truth.files).toContain('src/pricing.ts');

    const { files } = walkRepo(repoRoot);
    // Ensure patch file is outside the walked repo
    expect(files.some((f) => f.path.includes('ground-truth'))).toBe(false);

    const task = parseTask(issue);
    const candidates = await gatherCandidates(files, task);
    const ranked = rankCandidates(candidates, task);
    const spans = selectSpans(ranked, files, 60);

    const { hitFile, hitRegion, relevantSpansEarly } = computeHitMetrics(spans, truth);
    console.log(
      `eval tax-bug: HitFile=${hitFile} HitRegion=${hitRegion} early=${relevantSpansEarly}`,
    );

    expect(hitFile).toBeGreaterThanOrEqual(1);
    expect(hitRegion).toBeGreaterThan(0);
    expect(relevantSpansEarly.startsWith('1/')).toBe(true);
  });

  it('oracle patch applies and would fix calculateTotal', () => {
    const tmp = fs.mkdtempSync(path.join(path.dirname(repoRoot), '.tmp-oracle-'));
    try {
      fs.cpSync(repoRoot, tmp, {
        recursive: true,
        filter: (p) => path.basename(p) !== 'node_modules',
      });
      const patch = fs.readFileSync(patchPath, 'utf8');
      expect(applyUnifiedDiff(tmp, patch)).toBe(true);
      const fixed = fs.readFileSync(path.join(tmp, 'src/pricing.ts'), 'utf8');
      expect(fixed).toContain('return addTax(subtotal, taxRate)');
      expect(fixed).not.toContain('BUG: taxRate is ignored');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('parser tree.delete path', () => {
  it('parses symbols without throwing (WASM or regex fallback)', async () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src/pricing.ts'), 'utf8');
    const syms = await parseSymbols('src/pricing.ts', src);
    expect(syms.some((s) => s.name === 'calculateTotal')).toBe(true);
  });
});

describe('ground-truth parser', () => {
  it('extracts regions from unified diff', () => {
    const truth = parseGroundTruthPatch(fs.readFileSync(patchPath, 'utf8'));
    expect(truth.files).toEqual(['src/pricing.ts']);
    expect(truth.regions[0]!.lineStart).toBeGreaterThan(0);
  });
});
