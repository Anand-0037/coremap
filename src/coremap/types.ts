/** Shared CoreMap types — every module imports from here. */

export type SelectionReason =
  | 'exact-term'
  | 'exact-path'
  | 'exact-symbol'
  | 'lexical'
  | 'symbol-signature'
  | 'import-neighbor'
  | 'reverse-import'
  | 'nearby-test'
  | 'entrypoint'
  | 'config';

export interface ScoreHints {
  exactMention: number;
  lexical: number;
  importNeighbor: number;
  centrality: number;
}

export interface Candidate {
  path: string;
  lineStart: number;
  lineEnd: number;
  reason: SelectionReason;
  scoreHints: ScoreHints;
  symbolName?: string;
  contentPreview?: string;
}

export interface SelectedSpan {
  path: string;
  lineStart: number;
  lineEnd: number;
  reason: SelectionReason;
  rank: number;
  tokens: number;
  contentHash: string;
  lines: string[];
}

export interface VerifyResult {
  patchProduced: boolean;
  testsPassed: boolean | null;
  tokens: number;
  /** Wall time is stdout-only; persisted receipts always store 0 for determinism. */
  ms: number;
  skippedReason?: string;
}

export interface BaselineResult {
  tokens: number;
  testsPassed: boolean | null;
}

export interface Receipt {
  task: string;
  budgetLines: number;
  tokensUsed: number;
  filesSelected: number;
  filesRejected: number;
  excludedForSecrets: number;
  /** Timing is stdout-only; always 0 in persisted receipts for byte-identical reruns. */
  retrievalMs: number;
  spans: SelectedSpan[];
  verify?: VerifyResult;
  baseline?: BaselineResult;
  hitFile?: number;
  hitRegion?: number;
}

export interface ParsedTask {
  raw: string;
  terms: string[];
  symbols: string[];
  paths: string[];
}

export interface WalkedFile {
  path: string;
  absolutePath: string;
  content: string;
}

export interface CliOptions {
  path: string;
  /** When set → task mode (spans + receipt). When absent → pack mode. */
  task?: string;
  budgetLines: number;
  verify: boolean;
  noLlm: boolean;
  outDir: string;
  /** Path to unified diff — used ONLY for HitFile/HitRegion + optional oracle verify. */
  groundTruth?: string;
  /** Pack mode: token budget for whole-file inclusion (default 50000). */
  maxTokens?: number;
  /** Pack mode output filename (default coremap.md). */
  outFile?: string;
}

export function emptyScoreHints(partial?: Partial<ScoreHints>): ScoreHints {
  return {
    exactMention: partial?.exactMention ?? 0,
    lexical: partial?.lexical ?? 0,
    importNeighbor: partial?.importNeighbor ?? 0,
    centrality: partial?.centrality ?? 0,
  };
}
