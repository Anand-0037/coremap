import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { WalkedFile } from './types.js';
import { contentLooksSecret } from './secrets.js';

const DEFAULT_IGNORES = [
  '.git',
  '.git/**',
  'node_modules',
  'node_modules/**',
  'dist',
  'dist/**',
  'build',
  'build/**',
  'coverage',
  'coverage/**',
  '.next',
  '.next/**',
  '.turbo',
  '.turbo/**',
  '.cache',
  '.cache/**',
  '**/.env',
  '**/.env.*',
  '**/*.min.js',
  '**/*.map',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.webp',
  '**/*.ico',
  '**/*.pdf',
  '**/*.zip',
  '**/*.gz',
  '**/*.wasm',
  '**/coremap-context.md',
  '**/coremap-receipt.json',
  '**/coremap.md',
  '**/repomap.txt',
];

/** Broad text inclusion; symbol parsing stays TS/JS-only. */
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.txt',
  '.sh',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.vue',
  '.svelte',
  '.sql',
  '.prisma',
  '.graphql',
  '.gql',
  '.kt',
  '.swift',
]);

function readIgnoreFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function buildIgnore(root: string): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);
  ig.add(readIgnoreFile(path.join(root, '.gitignore')));
  ig.add(readIgnoreFile(path.join(root, '.ignore')));
  ig.add(readIgnoreFile(path.join(root, '.coremapignore')));
  ig.add(readIgnoreFile(path.join(root, '.git', 'info', 'exclude')));
  return ig;
}

function isSecretPath(rel: string): boolean {
  const base = path.basename(rel).toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base.endsWith('.pem')) return true;
  if (/\bcredentials\b/.test(base)) return true;
  // secrets.json / .secrets — not source modules like secrets.ts
  if (base === '.secrets' || /^secrets?\.(json|ya?ml|txt|env)$/.test(base)) return true;
  return false;
}

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist' || name === 'coverage';
}

/**
 * gitignore-aware walk. Returns relative POSIX paths + content.
 * Skips unreadable files without aborting.
 * Excludes secrets by path AND content.
 */
export function walkRepo(rootPath: string): {
  files: WalkedFile[];
  excludedForSecrets: number;
  rejected: number;
} {
  const root = path.resolve(rootPath);
  const ig = buildIgnore(root);
  const files: WalkedFile[] = [];
  let excludedForSecrets = 0;
  let rejected = 0;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      rejected += 1;
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        if (ig.ignores(rel) || ig.ignores(`${rel}/`)) continue;
        walk(abs);
        continue;
      }

      if (!entry.isFile()) continue;
      if (isSecretPath(rel)) {
        excludedForSecrets += 1;
        continue;
      }
      if (ig.ignores(rel)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXT.has(ext) && entry.name !== 'Dockerfile' && entry.name !== 'Makefile') {
        continue;
      }

      try {
        const content = fs.readFileSync(abs, 'utf8');
        if (content.includes('\0')) {
          rejected += 1;
          continue;
        }
        if (contentLooksSecret(content)) {
          excludedForSecrets += 1;
          continue;
        }
        files.push({ path: rel, absolutePath: abs, content });
      } catch {
        rejected += 1;
      }
    }
  }

  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excludedForSecrets, rejected };
}
