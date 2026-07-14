import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countTokens } from '../src/coremap/tokens.js';
import { contentLooksSecret } from '../src/coremap/secrets.js';
import { walkRepo } from '../src/coremap/walker.js';
import { parseSymbols } from '../src/coremap/parser.js';
import { runCoreMap } from '../src/coremap/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const miniRoot = path.join(here, '..', 'fixtures', 'mini-repo');
const evalRoot = path.join(here, '..', 'fixtures', 'eval-tax-bug');
const issuePath = path.join(here, '..', 'evals', 'tax-bug', 'issue.txt');
const patchPath = path.join(here, '..', 'evals', 'tax-bug', 'ground-truth.patch');

describe('tokens', () => {
  it('uses js-tiktoken (not chars/4)', () => {
    const text = 'export function calculateTotal() { return 1; }';
    const n = countTokens(text);
    expect(n).toBeGreaterThan(0);
    // chars/4 would be ~11; real o200k encoding is different and stable
    expect(n).not.toBe(Math.ceil(text.length / 4));
  });
});

describe('secrets', () => {
  it('detects sk- keys and private key headers', () => {
    expect(contentLooksSecret('const k = "sk-abcdefghijklmnopqrstuvwxyz012345"')).toBe(true);
    expect(contentLooksSecret('-----BEGIN RSA PRIVATE KEY-----\nabc')).toBe(true);
    expect(contentLooksSecret('export function add(a: number) { return a; }')).toBe(false);
  });

  it('excludes content-secret files from walk and increments excludedForSecrets', () => {
    const { files, excludedForSecrets } = walkRepo(miniRoot);
    expect(files.some((f) => f.path.includes('leaked-key'))).toBe(false);
    expect(excludedForSecrets).toBeGreaterThanOrEqual(1);
  });
});

describe('parser resolve', () => {
  it('finds foo via tree-sitter or regex fallback', async () => {
    const syms = await parseSymbols('x.ts', 'export function foo() {}\n');
    expect(syms.some((s) => s.name === 'foo')).toBe(true);
  });
});

describe('deterministic receipt under --verify', () => {
  it('two verify runs produce byte-identical receipt.json', async () => {
    const issue = fs.readFileSync(issuePath, 'utf8');
    const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coremap-a-'));
    const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coremap-b-'));
    try {
      const opts = {
        path: evalRoot,
        task: issue,
        budgetLines: 25,
        verify: true,
        noLlm: true,
        groundTruth: patchPath,
      };
      await runCoreMap({ ...opts, outDir: aDir });
      await runCoreMap({ ...opts, outDir: bDir });
      const a = fs.readFileSync(path.join(aDir, 'coremap-receipt.json'), 'utf8');
      const b = fs.readFileSync(path.join(bDir, 'coremap-receipt.json'), 'utf8');
      expect(a).toBe(b);
      const parsed = JSON.parse(a) as { retrievalMs: number; verify?: { ms: number } };
      expect(parsed.retrievalMs).toBe(0);
      expect(parsed.verify?.ms).toBe(0);
    } finally {
      fs.rmSync(aDir, { recursive: true, force: true });
      fs.rmSync(bDir, { recursive: true, force: true });
    }
  }, 120_000);
});
