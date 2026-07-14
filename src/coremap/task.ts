import type { ParsedTask } from './types.js';

const PATH_RE = /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+)(?=$|[\s`"'),:])/g;
const SYMBOL_RE = /\b([A-Z][a-zA-Z0-9]{1,}|[a-z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]+)+)\b/g;
const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'when',
  'where',
  'which',
  'should',
  'would',
  'could',
  'fix',
  'bug',
  'issue',
  'error',
  'fail',
  'fails',
  'failed',
  'please',
  'need',
  'needs',
  'make',
  'sure',
  'add',
  'update',
  'change',
  'repo',
  'file',
  'code',
  'function',
  'class',
  'test',
  'tests',
]);

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Parse --task into search terms, mentioned symbols, and mentioned paths.
 * Pure and deterministic.
 */
export function parseTask(raw: string): ParsedTask {
  const text = raw.trim();
  const paths: string[] = [];
  for (const match of text.matchAll(PATH_RE)) {
    paths.push(match[1]!.replace(/^\.\//, ''));
  }

  const symbols: string[] = [];
  for (const match of text.matchAll(SYMBOL_RE)) {
    symbols.push(match[1]!);
  }

  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9_./\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t) && !t.includes('/'));

  return {
    raw: text,
    terms: uniqSorted(terms),
    symbols: uniqSorted(symbols),
    paths: uniqSorted(paths),
  };
}
