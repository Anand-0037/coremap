import { describe, expect, it } from 'vitest';
import { parseCliArgv } from '../src/cli.js';

describe('CLI flags', () => {
  it('parses task, budget-lines, verify, and no-llm', () => {
    const opts = parseCliArgv([
      './fixtures/mini-repo',
      '--task',
      'fix calculateTotal tax',
      '--budget-lines',
      '40',
      '--verify',
      '--no-llm',
    ]);

    expect(opts.path).toBe('./fixtures/mini-repo');
    expect(opts.task).toBe('fix calculateTotal tax');
    expect(opts.budgetLines).toBe(40);
    expect(opts.verify).toBe(true);
    expect(opts.noLlm).toBe(true);
  });

  it('defaults budget-lines to 200', () => {
    const opts = parseCliArgv(['.', '--task', 'hello world issue']);
    expect(opts.budgetLines).toBe(200);
    expect(opts.verify).toBe(false);
    expect(opts.noLlm).toBe(false);
  });

  it('allows missing --task (pack mode) and parses pack flags', () => {
    const opts = parseCliArgv(['./fixtures/mini-repo', '--max-tokens', '1000', '--out-file', 'repomap.txt']);
    expect(opts.task).toBeUndefined();
    expect(opts.maxTokens).toBe(1000);
    expect(opts.outFile).toBe('repomap.txt');
  });

  it('supports --version (commander exitOverride)', () => {
    expect(() => parseCliArgv(['--version'])).toThrow(/0\.1\.\d+/);
  });
});
