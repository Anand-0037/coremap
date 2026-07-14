import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { BaselineResult, Receipt, VerifyResult } from './types.js';

async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, ms: Date.now() - t0 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message, ms: Date.now() - t0 });
    });
  });
}

function copyRepo(src: string, dest: string): void {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== 'node_modules' && base !== '.git' && base !== 'dist';
    },
  });
}

export async function runRepoTests(repoRoot: string): Promise<{ passed: boolean; ms: number; output: string }> {
  if (!fs.existsSync(path.join(repoRoot, 'package.json'))) {
    return { passed: false, ms: 0, output: 'no package.json' };
  }
  if (!fs.existsSync(path.join(repoRoot, 'node_modules'))) {
    await runCommand(repoRoot, 'npm', ['install', '--silent'], 180_000);
  }
  const result = await runCommand(repoRoot, 'npx', ['vitest', 'run'], 120_000);
  return {
    passed: result.code === 0,
    ms: result.ms,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

function extractUnifiedDiff(text: string): string | null {
  const start = text.indexOf('--- ');
  if (start < 0) {
    const alt = text.indexOf('diff --git');
    if (alt < 0) return null;
    return text.slice(alt).trim();
  }
  return text.slice(start).trim();
}

/**
 * Minimal unified-diff applier for single-file hunks (demo oracle + LLM patches).
 * Locates the old hunk body in the file and replaces it with the new body.
 */
export function applyUnifiedDiff(repoRoot: string, patchText: string): boolean {
  type Hunk = { path: string; oldLines: string[]; newLines: string[] };
  const hunks: Hunk[] = [];
  let filePath: string | null = null;
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let collecting = false;

  const push = () => {
    if (filePath && collecting) {
      hunks.push({ path: filePath, oldLines, newLines });
    }
    oldLines = [];
    newLines = [];
    collecting = false;
  };

  for (const raw of patchText.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      push();
      const p = raw.slice(4).trim().replace(/^b\//, '');
      filePath = p === '/dev/null' ? null : p;
      continue;
    }
    if (/^@@\s+/.test(raw)) {
      push();
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      newLines.push(raw.slice(1));
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      oldLines.push(raw.slice(1));
    } else if (raw.startsWith(' ')) {
      const body = raw.slice(1);
      oldLines.push(body);
      newLines.push(body);
    }
  }
  push();

  if (hunks.length === 0) return false;

  for (const hunk of hunks) {
    const abs = path.join(repoRoot, hunk.path);
    if (!fs.existsSync(abs)) return false;
    const text = fs.readFileSync(abs, 'utf8');
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const current = text.split(/\r?\n/);
    const oldBlock = hunk.oldLines.join('\n');
    const joined = current.join('\n');
    const idx = joined.indexOf(oldBlock);
    if (idx < 0) return false;
    const before = joined.slice(0, idx);
    const after = joined.slice(idx + oldBlock.length);
    const next = `${before}${hunk.newLines.join('\n')}${after}`;
    fs.writeFileSync(abs, next.split('\n').join(nl), 'utf8');
  }
  return true;
}

async function openaiPatchAttempt(opts: {
  task: string;
  contextMarkdown: string;
}): Promise<{ patch: string | null; tokens: number }> {
  // Lazy-load so pack / offline / oracle paths never pull in the OpenAI SDK
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI();
  const model = process.env.COREMAP_MODEL ?? 'gpt-4.1-mini';
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise coding agent. Given a task and a CoreMap context pack of exact source spans, produce ONE unified diff patch that fixes the issue. Output ONLY the patch, starting with --- or diff --git. No markdown fences.',
      },
      {
        role: 'user',
        content: `TASK:\n${opts.task}\n\nCONTEXT PACK:\n${opts.contextMarkdown}\n\nReturn a unified diff only.`,
      },
    ],
  });
  const text = response.choices[0]?.message?.content ?? '';
  const tokens =
    (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
  return { patch: extractUnifiedDiff(text), tokens };
}

/**
 * When --verify:
 * - no key / --no-llm: clear skip (R8); if --ground-truth set, oracle-apply in TEMP copy + tests
 * - with key: ONE OpenAI patch attempt in TEMP copy, then tests
 * Never mutates the source repo.
 */
export async function runVerify(opts: {
  verify: boolean;
  noLlm: boolean;
  hasApiKey: boolean;
  task: string;
  contextPath: string;
  repoRoot: string;
  groundTruthPatchPath?: string;
}): Promise<VerifyResult | undefined> {
  if (!opts.verify) return undefined;

  const t0 = Date.now();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'coremap-verify-'));

  try {
    copyRepo(opts.repoRoot, work);

    if (opts.noLlm || !opts.hasApiKey) {
      const reason = opts.noLlm
        ? '--no-llm set; skipping LLM patch attempt'
        : 'OPENAI_API_KEY not set; skipping LLM patch attempt';
      console.log(`coremap: ${reason}`);

      if (opts.groundTruthPatchPath && fs.existsSync(opts.groundTruthPatchPath)) {
        console.log(
          'coremap: applying ground-truth oracle patch in temp workdir (never used in selection)',
        );
        const patchText = fs.readFileSync(opts.groundTruthPatchPath, 'utf8');
        const applied = applyUnifiedDiff(work, patchText);
        if (!applied) {
          return {
            patchProduced: false,
            testsPassed: false,
            tokens: 0,
            ms: Date.now() - t0,
            skippedReason: `${reason}; oracle patch failed to apply`,
          };
        }
        const tests = await runRepoTests(work);
        return {
          patchProduced: true,
          testsPassed: tests.passed,
          tokens: 0,
          ms: Date.now() - t0,
          skippedReason: `${reason}; used oracle patch`,
        };
      }

      const tests = await runRepoTests(work);
      return {
        patchProduced: false,
        testsPassed: tests.passed,
        tokens: 0,
        ms: Date.now() - t0,
        skippedReason: reason,
      };
    }

    const contextMarkdown = fs.readFileSync(opts.contextPath, 'utf8');
    let patch: string | null;
    let tokens: number;
    try {
      ({ patch, tokens } = await openaiPatchAttempt({
        task: opts.task,
        contextMarkdown,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `coremap: LLM patch attempt failed; context and receipt were still written (${message})`,
      );
      return {
        patchProduced: false,
        testsPassed: false,
        tokens: 0,
        ms: Date.now() - t0,
        skippedReason: 'LLM patch attempt failed; context and receipt were still written',
      };
    }
    if (!patch) {
      return { patchProduced: false, testsPassed: false, tokens, ms: Date.now() - t0 };
    }
    const applied = applyUnifiedDiff(work, patch);
    if (!applied) {
      return {
        patchProduced: true,
        testsPassed: false,
        tokens,
        ms: Date.now() - t0,
        skippedReason: 'patch produced but failed to apply',
      };
    }
    const tests = await runRepoTests(work);
    return {
      patchProduced: true,
      testsPassed: tests.passed,
      tokens,
      ms: Date.now() - t0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`coremap: verify error: ${msg}`);
    return {
      patchProduced: false,
      testsPassed: false,
      tokens: 0,
      ms: Date.now() - t0,
      skippedReason: msg,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function attachVerify(receipt: Receipt, verify: VerifyResult | undefined): Receipt {
  if (!verify) return receipt;
  return { ...receipt, verify };
}

export function attachBaseline(receipt: Receipt, baseline: BaselineResult): Receipt {
  return { ...receipt, baseline };
}

export async function measureBaselineTests(repoRoot: string): Promise<boolean | null> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'coremap-base-'));
  try {
    copyRepo(repoRoot, work);
    const tests = await runRepoTests(work);
    return tests.passed;
  } catch {
    return null;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
