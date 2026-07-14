import fs from 'node:fs';
import path from 'node:path';
import { parseTask } from './task.js';
import { walkRepo } from './walker.js';
import { gatherCandidates } from './candidates.js';
import { rankCandidates } from './rank.js';
import { selectSpans } from './select.js';
import { buildReceipt, writeReceiptArtifacts } from './receipt.js';
import { printReport } from './report.js';
import {
  attachBaseline,
  attachVerify,
  measureBaselineTests,
  runVerify,
} from './verify.js';
import { compressToSignatures } from './parser.js';
import { computeHitMetrics, loadGroundTruth } from './hits.js';
import { countTokens } from './tokens.js';
import { runPack } from './pack.js';
import type { CliOptions, Receipt, VerifyResult } from './types.js';

/** Strip wall-clock from verify before persisting (determinism). */
function persistableVerify(verify: VerifyResult | undefined): VerifyResult | undefined {
  if (!verify) return undefined;
  return { ...verify, ms: 0 };
}

/**
 * Router: no --task → pack mode; with --task → existing task pipeline (unchanged).
 */
export async function runCoreMap(opts: CliOptions): Promise<Receipt | null> {
  if (!opts.task || opts.task.trim().length === 0) {
    await runPack(opts);
    return null;
  }
  return runTaskMode({ ...opts, task: opts.task });
}

/**
 * Task mode — ranked spans + receipt + optional verify.
 * Keep this path byte-identical for the pinned demo.
 */
async function runTaskMode(opts: CliOptions & { task: string }): Promise<Receipt> {
  const t0 = Date.now();
  const root = path.resolve(opts.path);
  const { files, excludedForSecrets, rejected } = walkRepo(root);
  const task = parseTask(opts.task);
  const candidates = await gatherCandidates(files, task);
  const ranked = rankCandidates(candidates, task);
  const spans = selectSpans(ranked, files, opts.budgetLines);

  const retrievalMsWall = Math.max(0, Date.now() - t0);

  let receipt = buildReceipt({
    task: opts.task,
    budgetLines: opts.budgetLines,
    spans,
    filesRejected: rejected,
    excludedForSecrets,
    retrievalMs: 0, // stdout-only timing
  });

  const fullTokens = files.reduce((n, f) => n + countTokens(f.content), 0);
  const compressTokens = countTokens(compressToSignatures(files));

  let relevantSpansEarly = '—';
  if (opts.groundTruth) {
    const truth = loadGroundTruth(path.resolve(opts.groundTruth));
    const hits = computeHitMetrics(spans, truth);
    receipt = {
      ...receipt,
      hitFile: hits.hitFile,
      hitRegion: hits.hitRegion,
    };
    relevantSpansEarly = hits.relevantSpansEarly;
    console.log(
      `coremap: HitFile=${hits.hitFile.toFixed(2)}  HitRegion≈${hits.hitRegion.toFixed(2)}  early=${hits.relevantSpansEarly}`,
    );
  }

  const outDir = path.resolve(opts.outDir);

  let baselineTests: boolean | null = null;
  if (opts.verify) {
    baselineTests = await measureBaselineTests(root);
  }
  receipt = attachBaseline(receipt, {
    tokens: fullTokens,
    testsPassed: baselineTests,
  });

  const { contextPath, receiptPath } = writeReceiptArtifacts(outDir, receipt);

  const verify = await runVerify({
    verify: opts.verify,
    noLlm: opts.noLlm,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    task: opts.task,
    contextPath,
    repoRoot: root,
    groundTruthPatchPath: opts.groundTruth,
  });
  const verifyWallMs = verify?.ms ?? 0;
  receipt = attachVerify(receipt, persistableVerify(verify));
  writeReceiptArtifacts(outDir, receipt);

  printReport(receipt, {
    fullTokens,
    compressTokens,
    relevantSpansEarly,
    hitFile: receipt.hitFile,
    hitRegion: receipt.hitRegion,
  });

  console.log(`Wrote ${contextPath}`);
  console.log(`Wrote ${receiptPath}`);
  console.log(
    `Selected ${spans.length} spans / ${receipt.filesSelected} files / ${receipt.tokensUsed} tokens (budget ${opts.budgetLines} lines) in ${retrievalMsWall}ms` +
      (opts.verify ? ` (verify wall ${verifyWallMs}ms)` : ''),
  );

  return receipt;
}

/** Offline selection-only helper for tests. */
export async function selectForTask(
  repoPath: string,
  taskText: string,
  budgetLines: number,
): Promise<Receipt['spans']> {
  const root = path.resolve(repoPath);
  const { files } = walkRepo(root);
  const task = parseTask(taskText);
  const candidates = await gatherCandidates(files, task);
  const ranked = rankCandidates(candidates, task);
  return selectSpans(ranked, files, budgetLines);
}

export function readIssueFile(issuePath: string): string {
  return fs.readFileSync(issuePath, 'utf8').trim();
}
