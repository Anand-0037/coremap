#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runCoreMap } from './coremap/run.js';
import type { CliOptions } from './coremap/types.js';

function readPackageVersion(): string {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function configureProgram(program: Command): Command {
  return program
    .name('coremap')
    .description(
      'CoreMap — pack a repo into one file, or pass --task for smallest sufficient evidence + verification receipt',
    )
    .version(readPackageVersion())
    .argument('[path]', 'repository path', '.')
    .option('--task <text>', 'issue or change request (enables task mode: spans + receipt)')
    .option('--budget-lines <n>', 'task mode: max source lines in the context pack', '200')
    .option('--verify', 'task mode: run one patch attempt + tests (LLM or oracle)', false)
    .option('--no-llm', 'task mode: force offline selection; skip LLM patch')
    .option(
      '--ground-truth <patch>',
      'task mode: unified diff for HitFile/HitRegion only (never fed into selection)',
    )
    .option('--max-tokens <n>', 'pack mode: max tokens for whole-file inclusion', '50000')
    .option('--out-file <name>', 'pack mode: output filename', 'coremap.md')
    .option('--out-dir <dir>', 'output directory', '.');
}

export function optionsFromProgram(program: Command): CliOptions {
  const opts = program.opts();
  const budget = Number.parseInt(String(opts.budgetLines ?? '200'), 10);
  if (!Number.isFinite(budget) || budget < 1) {
    throw new Error('--budget-lines must be a positive integer');
  }
  const maxTokens = Number.parseInt(String(opts.maxTokens ?? '50000'), 10);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) {
    throw new Error('--max-tokens must be a positive integer');
  }
  const noLlm = opts.llm === false || opts.noLlm === true;

  // Do not coerce missing --task to the string "undefined"
  const taskRaw = opts.task;
  const task =
    typeof taskRaw === 'string' && taskRaw.trim().length > 0 ? taskRaw : undefined;

  return {
    path: program.args[0] ?? '.',
    task,
    budgetLines: budget,
    verify: Boolean(opts.verify),
    noLlm: Boolean(noLlm),
    outDir: String(opts.outDir ?? '.'),
    groundTruth: opts.groundTruth ? String(opts.groundTruth) : undefined,
    maxTokens,
    outFile: opts.outFile ? String(opts.outFile) : 'coremap.md',
  };
}

/** Parse argv into CliOptions without running the pipeline (for tests). */
export function parseCliArgv(argv: string[]): CliOptions {
  const program = configureProgram(new Command());
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.parse(argv, { from: 'user' });
  return optionsFromProgram(program);
}

async function main(argv: string[]): Promise<void> {
  const program = configureProgram(new Command());
  program.action(async () => {
    try {
      const options = optionsFromProgram(program);
      await runCoreMap(options);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`coremap: ${message}`);
      process.exitCode = 1;
    }
  });
  await program.parseAsync(argv);
}

/** CLI entry used by `bin/coremap` and direct `node dist/cli.js`. */
export async function runCli(argv: string[] = process.argv): Promise<void> {
  await main(argv);
}

function isDirectEntry(): boolean {
  if (typeof process.argv[1] !== 'string') return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isDirectEntry()) {
  runCli(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`coremap: ${message}`);
    process.exitCode = 1;
  });
}
