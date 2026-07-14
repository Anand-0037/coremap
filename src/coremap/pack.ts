import fs from 'node:fs';
import path from 'node:path';
import { walkRepo } from './walker.js';
import { countTokens } from './tokens.js';
import { renderTree } from './tree.js';
import type { CliOptions, WalkedFile } from './types.js';

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
  '.prisma': 'prisma',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.json': 'json',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.sh': 'bash',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
};

function fenceLang(filePath: string): string {
  return LANG_BY_EXT[path.extname(filePath).toLowerCase()] ?? '';
}

function isReadmeOrDoc(p: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  if (base === 'readme' || base.startsWith('readme.')) return true;
  if (base === 'changelog' || base.startsWith('changelog.')) return true;
  if (p.toLowerCase().startsWith('docs/') || p.toLowerCase().includes('/docs/')) return true;
  return base.endsWith('.md') || base.endsWith('.mdx');
}

function isConfig(p: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  return (
    base === 'package.json' ||
    base === 'tsconfig.json' ||
    base === 'pyproject.toml' ||
    base === 'cargo.toml' ||
    base === 'go.mod' ||
    base.endsWith('.config.ts') ||
    base.endsWith('.config.js') ||
    base.endsWith('.config.mjs') ||
    base.startsWith('.') && (base.endsWith('rc') || base.includes('ignore'))
  );
}

function isEntrypoint(p: string): boolean {
  const base = path.posix.basename(p).toLowerCase();
  return (
    base === 'index.ts' ||
    base === 'index.js' ||
    base === 'index.tsx' ||
    base === 'main.ts' ||
    base === 'main.js' ||
    base === 'main.py' ||
    base === 'app.ts' ||
    base === 'app.js' ||
    base === 'app.tsx' ||
    base === 'server.ts' ||
    base === 'server.js' ||
    base === 'cli.ts' ||
    base === 'cli.js'
  );
}

function isTest(p: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(p) ||
    p.includes('/__tests__/') ||
    p.includes('/tests/') ||
    p.startsWith('tests/') ||
    p.endsWith('_test.go') ||
    p.endsWith('_test.py')
  );
}

/** Priority: README/docs → config → entrypoints → other source → tests. Ties: alpha. */
export function packPriority(filePath: string): number {
  if (isReadmeOrDoc(filePath)) return 0;
  if (isConfig(filePath)) return 1;
  if (isEntrypoint(filePath)) return 2;
  if (isTest(filePath)) return 4;
  return 3;
}

export function orderForPack(files: WalkedFile[]): WalkedFile[] {
  return [...files].sort((a, b) => {
    const pa = packPriority(a.path);
    const pb = packPriority(b.path);
    if (pa !== pb) return pa - pb;
    return a.path.localeCompare(b.path);
  });
}

export interface PackBuildResult {
  markdown: string;
  filesScanned: number;
  filesIncluded: number;
  filesExcluded: number;
  secretsExcluded: number;
  estimatedTokens: number;
  truncated: boolean;
  omitted: number;
}

/**
 * Build pack markdown (deterministic). Pure given walked inputs.
 */
export function buildPackMarkdown(input: {
  repoName: string;
  files: WalkedFile[];
  excludedForSecrets: number;
  rejected: number;
  maxTokens: number;
}): PackBuildResult {
  const ordered = orderForPack(input.files);
  const included: WalkedFile[] = [];
  let tokens = 0;
  let truncated = false;

  for (const file of ordered) {
    const fileTokens = countTokens(file.content);
    if (included.length > 0 && tokens + fileTokens > input.maxTokens) {
      truncated = true;
      break;
    }
    // Always allow at least the first file even if over budget (honest pack, not empty)
    if (included.length === 0 && fileTokens > input.maxTokens) {
      included.push(file);
      tokens += fileTokens;
      truncated = ordered.length > 1;
      break;
    }
    included.push(file);
    tokens += fileTokens;
  }

  const omitted = ordered.length - included.length;
  const tree = renderTree(
    input.files.map((f) => ({ path: f.path })),
    input.repoName,
  );

  const parts: string[] = [
    `# CoreMap: ${input.repoName}`,
    '',
    '## Directory tree',
    '',
    '```',
    tree,
    '```',
    '',
    '## Files',
    '',
  ];

  for (const file of included) {
    const lang = fenceLang(file.path);
    parts.push(`### ${file.path}`);
    parts.push('');
    parts.push(`\`\`\`${lang}`);
    parts.push(file.content.endsWith('\n') ? file.content.slice(0, -1) : file.content);
    parts.push('```');
    parts.push('');
  }

  parts.push('## Summary');
  parts.push('');
  parts.push(`- Files scanned: ${input.files.length + input.rejected + input.excludedForSecrets}`);
  parts.push(`- Files included: ${included.length}`);
  parts.push(`- Files excluded (ignored/binary): ${input.rejected}`);
  parts.push(`- Secrets excluded: ${input.excludedForSecrets}`);
  parts.push(`- Estimated tokens: ${tokens}`);
  if (truncated) {
    parts.push(
      `- Truncated: yes (budget --max-tokens reached; ${omitted} files omitted)`,
    );
  } else {
    parts.push('- Truncated: no');
  }
  parts.push('');

  return {
    markdown: parts.join('\n'),
    filesScanned: input.files.length + input.rejected + input.excludedForSecrets,
    filesIncluded: included.length,
    filesExcluded: input.rejected,
    secretsExcluded: input.excludedForSecrets,
    estimatedTokens: tokens,
    truncated,
    omitted,
  };
}

/**
 * Full-repo pack mode: tree + whole files + summary into one markdown file.
 */
export async function runPack(opts: CliOptions): Promise<PackBuildResult> {
  const root = path.resolve(opts.path);
  const repoName = path.basename(root) || 'repo';
  const { files, excludedForSecrets, rejected } = walkRepo(root);
  const maxTokens = opts.maxTokens ?? 50_000;

  const result = buildPackMarkdown({
    repoName,
    files,
    excludedForSecrets,
    rejected,
    maxTokens,
  });

  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = opts.outFile ?? 'coremap.md';
  const outPath = path.join(outDir, outFile);
  fs.writeFileSync(outPath, result.markdown, 'utf8');

  console.log('');
  console.log(`coremap: pack mode → ${outPath}`);
  console.log(`  Files scanned: ${result.filesScanned}`);
  console.log(`  Files included: ${result.filesIncluded}`);
  console.log(`  Files excluded (ignored/binary): ${result.filesExcluded}`);
  console.log(`  Secrets excluded: ${result.secretsExcluded}`);
  console.log(`  Estimated tokens: ${result.estimatedTokens}`);
  if (result.truncated) {
    console.log(
      `  Truncated: yes (budget --max-tokens=${maxTokens}; ${result.omitted} files omitted)`,
    );
  } else {
    console.log('  Truncated: no');
  }
  console.log('');

  return result;
}
