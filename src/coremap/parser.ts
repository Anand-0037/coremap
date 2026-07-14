import path from 'node:path';
import { createRequire } from 'node:module';
import { Parser, Language, Query, type Tree } from 'web-tree-sitter';

export interface ParsedSymbol {
  name: string;
  lineStart: number;
  lineEnd: number;
  kind: string;
}

let initPromise: Promise<void> | null = null;
let tsLang: Language | null = null;
let tsxLang: Language | null = null;
let sharedParser: Parser | null = null;
let initFailed = false;
let warnedFallback = false;

const require = createRequire(import.meta.url);

function resolvePackageFile(specifier: string): string {
  return require.resolve(specifier);
}

async function ensureParser(): Promise<boolean> {
  if (initFailed) return false;
  if (tsLang && tsxLang && sharedParser) return true;
  if (!initPromise) {
    initPromise = (async () => {
      const runtimeWasm = resolvePackageFile('web-tree-sitter/tree-sitter.wasm');
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName.endsWith('tree-sitter.wasm')) return runtimeWasm;
          return scriptName;
        },
      } as Parameters<typeof Parser.init>[0]);
      tsLang = await Language.load(
        resolvePackageFile('tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
      );
      tsxLang = await Language.load(
        resolvePackageFile('tree-sitter-wasms/out/tree-sitter-tsx.wasm'),
      );
      sharedParser = new Parser();
    })().catch((err: unknown) => {
      initFailed = true;
      if (!warnedFallback) {
        warnedFallback = true;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`coremap: tree-sitter init failed, falling back to regex (${msg})`);
      }
    });
  }
  await initPromise;
  return Boolean(tsLang && tsxLang && sharedParser);
}

const SYMBOL_QUERY = `
(function_declaration name: (identifier) @name) @def
(class_declaration name: (type_identifier) @name) @def
(lexical_declaration (variable_declarator name: (identifier) @name)) @def
(export_statement declaration: (function_declaration name: (identifier) @name) @def)
(export_statement declaration: (class_declaration name: (type_identifier) @name) @def)
(export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @name) @def))
(interface_declaration name: (type_identifier) @name) @def
(type_alias_declaration name: (type_identifier) @name) @def
(enum_declaration name: (identifier) @name) @def
`;

/**
 * Parse TS/JS with web-tree-sitter.
 * ALWAYS calls tree.delete() after use (WASM leak fix).
 * Reuses one Parser instance — do not parser.delete() per file (causes heap corruption).
 * On failure: log + return regex fallback (R9 — never abort).
 */
export async function parseSymbols(filePath: string, content: string): Promise<ParsedSymbol[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return [];

  try {
    const ok = await ensureParser();
    if (!ok || !tsLang || !tsxLang || !sharedParser) return parseSymbolsRegex(content);

    const lang = ext === '.tsx' || ext === '.jsx' ? tsxLang : tsLang;
    sharedParser.setLanguage(lang);

    let tree: Tree | null = null;
    try {
      tree = sharedParser.parse(content);
      if (!tree) return parseSymbolsRegex(content);

      const query = new Query(lang, SYMBOL_QUERY);
      try {
        const matches = query.matches(tree.rootNode);
        const out: ParsedSymbol[] = [];
        for (const m of matches) {
          const nameNode = m.captures.find((c) => c.name === 'name')?.node;
          const defNode = m.captures.find((c) => c.name === 'def')?.node ?? nameNode;
          if (!nameNode || !defNode) continue;
          out.push({
            name: nameNode.text,
            lineStart: defNode.startPosition.row + 1,
            lineEnd: Math.max(defNode.endPosition.row + 1, defNode.startPosition.row + 1),
            kind: defNode.type,
          });
        }
        const seen = new Set<string>();
        return out.filter((s) => {
          const k = `${s.name}:${s.lineStart}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      } finally {
        query.delete();
      }
    } finally {
      // Critical: free WASM Tree only (keep shared Parser alive)
      tree?.delete();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`coremap: parse skip ${filePath}: ${msg}`);
    return parseSymbolsRegex(content);
  }
}

/** Regex fallback — also used when WASM unavailable. */
export function parseSymbolsRegex(content: string): ParsedSymbol[] {
  const re =
    /^(?:export\s+)?(?:async\s+)?(?:function\*|function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const lines = content.split(/\r?\n/);
  const hits: ParsedSymbol[] = [];
  for (const match of content.matchAll(re)) {
    const name = match[1]!;
    let lineStart = 1;
    const idx = match.index ?? 0;
    for (let i = 0; i < idx; i++) if (content[i] === '\n') lineStart += 1;
    hits.push({
      name,
      lineStart,
      lineEnd: Math.min(lines.length, lineStart + 12),
      kind: 'regex',
    });
  }
  return hits;
}

/**
 * Compress-style baseline: keep only symbol signature lines (not full bodies).
 */
export function compressToSignatures(files: Array<{ path: string; content: string }>): string {
  const parts: string[] = [];
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const syms = parseSymbolsRegex(f.content);
    if (syms.length === 0) continue;
    parts.push(`# ${f.path}`);
    const lines = f.content.split(/\r?\n/);
    for (const s of syms) {
      const sig = lines[s.lineStart - 1] ?? s.name;
      parts.push(sig.trim());
    }
  }
  return parts.join('\n');
}
