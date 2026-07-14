import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPackMarkdown, runPack } from '../src/coremap/pack.js';
import { walkRepo } from '../src/coremap/walker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const miniRoot = path.join(here, '..', 'fixtures', 'mini-repo');

describe('pack mode', () => {
  it('produces tree + files, includes billing, excludes secrets', () => {
    const { files, excludedForSecrets, rejected } = walkRepo(miniRoot);
    const result = buildPackMarkdown({
      repoName: 'mini-repo',
      files,
      excludedForSecrets,
      rejected,
      maxTokens: 50_000,
    });

    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain('## Directory tree');
    expect(result.markdown).toContain('## Files');
    expect(result.markdown).toContain('src/billing.ts');
    expect(result.markdown).toContain('calculateTotal');
    expect(result.markdown).not.toContain('SECRET=demo');
    expect(result.markdown).not.toMatch(/\.env\.local/);
    expect(result.secretsExcluded).toBeGreaterThanOrEqual(1);

    const tokenLine = result.markdown.match(/- Estimated tokens: (\d+)/);
    expect(tokenLine).not.toBeNull();
    expect(Number(tokenLine![1])).toBeGreaterThan(0);
  });

  it('is byte-identical across reruns', () => {
    const { files, excludedForSecrets, rejected } = walkRepo(miniRoot);
    const a = buildPackMarkdown({
      repoName: 'mini-repo',
      files,
      excludedForSecrets,
      rejected,
      maxTokens: 50_000,
    });
    const b = buildPackMarkdown({
      repoName: 'mini-repo',
      files,
      excludedForSecrets,
      rejected,
      maxTokens: 50_000,
    });
    expect(a.markdown).toBe(b.markdown);
  });

  it('truncates when --max-tokens is very low', () => {
    const { files, excludedForSecrets, rejected } = walkRepo(miniRoot);
    expect(files.length).toBeGreaterThan(1);
    const result = buildPackMarkdown({
      repoName: 'mini-repo',
      files,
      excludedForSecrets,
      rejected,
      maxTokens: 1,
    });
    expect(result.truncated).toBe(true);
    expect(result.omitted).toBeGreaterThanOrEqual(1);
    expect(result.markdown).toContain('Truncated: yes');
  });

  it('runPack writes coremap.md', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coremap-pack-'));
    try {
      const result = await runPack({
        path: miniRoot,
        budgetLines: 200,
        verify: false,
        noLlm: true,
        outDir,
        maxTokens: 50_000,
        outFile: 'coremap.md',
      });
      const body = fs.readFileSync(path.join(outDir, 'coremap.md'), 'utf8');
      expect(body).toBe(result.markdown);
      expect(body).toContain('## Directory tree');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
