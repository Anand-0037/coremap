import path from 'node:path';
import type { Candidate, ParsedTask, SelectionReason, WalkedFile } from './types.js';
import { emptyScoreHints } from './types.js';
import { parseSymbols } from './parser.js';

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

const ENTRYPOINT_NAMES = new Set([
  'index.ts',
  'index.js',
  'index.tsx',
  'index.jsx',
  'main.ts',
  'main.js',
  'app.ts',
  'app.js',
  'app.tsx',
  'server.ts',
  'server.js',
  'cli.ts',
  'cli.js',
]);

const CONFIG_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vite.config.ts',
  'webpack.config.js',
  '.eslintrc',
  'eslint.config.js',
]);

interface ImportEdge {
  from: string;
  to: string;
}

function resolveImport(fromPath: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
  const dir = path.posix.dirname(fromPath);
  const resolved = path.posix.normalize(path.posix.join(dir, spec));
  if (resolved.startsWith('../')) return null;
  return resolved.replace(/^\.\//, '');
}

function extractImports(filePath: string, content: string): string[] {
  const out: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1]!;
    const resolved = resolveImport(filePath, spec);
    if (resolved) out.push(resolved);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

function withExtCandidates(p: string): string[] {
  if (/\.[a-z]+$/i.test(p)) return [p];
  return [`${p}.ts`, `${p}.tsx`, `${p}.js`, `${p}.jsx`, `${p}/index.ts`, `${p}/index.js`];
}

function findFile(files: Map<string, WalkedFile>, importPath: string): WalkedFile | undefined {
  for (const cand of withExtCandidates(importPath)) {
    const hit = files.get(cand);
    if (hit) return hit;
  }
  return undefined;
}

function isTestPath(p: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(p) ||
    p.includes('/__tests__/') ||
    p.includes('/tests/') ||
    p.startsWith('tests/')
  );
}

function lexicalScore(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) score += 1;
  }
  return score;
}

function pushCandidate(bag: Map<string, Candidate>, c: Candidate): void {
  const key = `${c.path}:${c.lineStart}:${c.lineEnd}:${c.reason}:${c.symbolName ?? ''}`;
  const prev = bag.get(key);
  if (!prev) {
    bag.set(key, c);
    return;
  }
  bag.set(key, {
    ...prev,
    scoreHints: {
      exactMention: Math.max(prev.scoreHints.exactMention, c.scoreHints.exactMention),
      lexical: Math.max(prev.scoreHints.lexical, c.scoreHints.lexical),
      importNeighbor: Math.max(prev.scoreHints.importNeighbor, c.scoreHints.importNeighbor),
      centrality: Math.max(prev.scoreHints.centrality, c.scoreHints.centrality),
    },
  });
}

function fileWindow(file: WalkedFile, reason: SelectionReason, hints: Candidate['scoreHints']): Candidate {
  const lines = file.content.split(/\r?\n/);
  const end = Math.min(lines.length, 40);
  return {
    path: file.path,
    lineStart: 1,
    lineEnd: Math.max(1, end),
    reason,
    scoreHints: hints,
    contentPreview: lines.slice(0, Math.min(3, lines.length)).join('\n'),
  };
}

/**
 * Gather typed candidates from a walked repo + parsed task.
 * Parse/symbol failures are skipped per-file (R9).
 */
export async function gatherCandidates(files: WalkedFile[], task: ParsedTask): Promise<Candidate[]> {
  const bag = new Map<string, Candidate>();
  const byPath = new Map(files.map((f) => [f.path, f]));
  const edges: ImportEdge[] = [];
  const inbound = new Map<string, number>();

  for (const file of files) {
    try {
      const imports = extractImports(file.path, file.content);
      for (const spec of imports) {
        const target = findFile(byPath, spec);
        if (!target) continue;
        edges.push({ from: file.path, to: target.path });
        inbound.set(target.path, (inbound.get(target.path) ?? 0) + 1);
      }
    } catch {
      continue;
    }
  }

  for (const file of files) {
    try {
      const base = path.posix.basename(file.path);
      const lex = lexicalScore(`${file.path}\n${file.content}`, task.terms);
      const pathMentioned = task.paths.some(
        (p) => file.path === p || file.path.endsWith(p) || file.path.includes(p),
      );

      if (pathMentioned) {
        pushCandidate(
          bag,
          fileWindow(file, 'exact-path', emptyScoreHints({ exactMention: 10, lexical: lex })),
        );
      }

      if (lex > 0) {
        const lines = file.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const lineLex = lexicalScore(lines[i]!, task.terms);
          if (lineLex === 0) continue;
          const start = Math.max(1, i + 1 - 2);
          const end = Math.min(lines.length, i + 1 + 8);
          pushCandidate(bag, {
            path: file.path,
            lineStart: start,
            lineEnd: end,
            reason: 'exact-term',
            scoreHints: emptyScoreHints({
              exactMention: lineLex >= 2 ? 6 : 2,
              lexical: lineLex + lex,
            }),
            contentPreview: lines[i],
          });
        }
      }

      // tree-sitter only when the file is relevant (precision + less WASM surface)
      const maybeHasSymbol = task.symbols.some((s) => file.content.includes(s));
      if (pathMentioned || lex > 0 || maybeHasSymbol) {
        const symbols = await parseSymbols(file.path, file.content);
        for (const sym of symbols) {
          const mentioned = task.symbols.some((s) => s === sym.name);
          const nameLex = lexicalScore(sym.name, task.terms);
          if (!mentioned && nameLex === 0 && lex === 0) continue;
          pushCandidate(bag, {
            path: file.path,
            lineStart: sym.lineStart,
            lineEnd: Math.max(sym.lineEnd, sym.lineStart + 1),
            reason: mentioned ? 'exact-symbol' : 'symbol-signature',
            scoreHints: emptyScoreHints({
              exactMention: mentioned ? 12 : 0,
              lexical: nameLex + (mentioned ? 0 : lex > 0 ? 1 : 0),
              centrality: inbound.get(file.path) ?? 0,
            }),
            symbolName: sym.name,
          });
        }
      }

      if (ENTRYPOINT_NAMES.has(base)) {
        pushCandidate(
          bag,
          fileWindow(
            file,
            'entrypoint',
            emptyScoreHints({
              centrality: 3 + (inbound.get(file.path) ?? 0),
              lexical: lex,
            }),
          ),
        );
      }

      if (CONFIG_NAMES.has(base) || base.endsWith('.config.ts') || base.endsWith('.config.js')) {
        pushCandidate(
          bag,
          fileWindow(file, 'config', emptyScoreHints({ centrality: 2, lexical: lex })),
        );
      }

      if (isTestPath(file.path) && lex > 0) {
        pushCandidate(
          bag,
          fileWindow(file, 'nearby-test', emptyScoreHints({ lexical: lex + 1, centrality: 1 })),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`coremap: candidate skip ${file.path}: ${msg}`);
      continue;
    }
  }

  const strongPaths = new Set(
    [...bag.values()]
      .filter((c) => c.scoreHints.exactMention >= 6 || c.scoreHints.lexical >= 2)
      .map((c) => c.path),
  );

  for (const edge of edges) {
    if (strongPaths.has(edge.from)) {
      const target = byPath.get(edge.to);
      if (target) {
        pushCandidate(
          bag,
          fileWindow(
            target,
            'import-neighbor',
            emptyScoreHints({
              importNeighbor: 4,
              centrality: inbound.get(target.path) ?? 0,
            }),
          ),
        );
      }
    }
    if (strongPaths.has(edge.to)) {
      const source = byPath.get(edge.from);
      if (source) {
        pushCandidate(
          bag,
          fileWindow(
            source,
            'reverse-import',
            emptyScoreHints({
              importNeighbor: 3,
              centrality: inbound.get(source.path) ?? 0,
            }),
          ),
        );
      }
    }
  }

  for (const p of strongPaths) {
    if (isTestPath(p)) continue;
    const stem = p.replace(/\.[jt]sx?$/, '');
    for (const file of files) {
      if (!isTestPath(file.path)) continue;
      if (
        file.path.includes(stem) ||
        file.path.includes(path.posix.basename(stem)) ||
        lexicalScore(file.path, task.terms) > 0
      ) {
        pushCandidate(
          bag,
          fileWindow(file, 'nearby-test', emptyScoreHints({ lexical: 2, importNeighbor: 1 })),
        );
      }
    }
  }

  return [...bag.values()].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
    if (a.lineEnd !== b.lineEnd) return a.lineEnd - b.lineEnd;
    return a.reason.localeCompare(b.reason);
  });
}
