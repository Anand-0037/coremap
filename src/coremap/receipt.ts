import fs from 'node:fs';
import path from 'node:path';
import type { Receipt, SelectedSpan } from './types.js';

function spanBlock(span: SelectedSpan): string {
  const header = `### ${span.path}:{${span.lineStart}-${span.lineEnd}}  rank=${span.rank}  reason=${span.reason}  tokens=${span.tokens}  hash=${span.contentHash}`;
  const fence = span.path.endsWith('.ts') || span.path.endsWith('.tsx') || span.path.endsWith('.js')
    ? 'typescript'
    : '';
  return `${header}\n\n\`\`\`${fence}\n${span.lines.join('\n')}\n\`\`\`\n`;
}

/**
 * Write coremap-context.md and coremap-receipt.json.
 * Deterministic: spans already sorted by rank then path.
 */
export function writeReceiptArtifacts(
  outDir: string,
  receipt: Receipt,
): { contextPath: string; receiptPath: string } {
  fs.mkdirSync(outDir, { recursive: true });

  const contextPath = path.join(outDir, 'coremap-context.md');
  const receiptPath = path.join(outDir, 'coremap-receipt.json');

  const body = [
    `# CoreMap context pack`,
    ``,
    `task: ${receipt.task}`,
    `budgetLines: ${receipt.budgetLines}`,
    `tokensUsed: ${receipt.tokensUsed}`,
    `filesSelected: ${receipt.filesSelected}`,
    ``,
    `## Spans`,
    ``,
    ...receipt.spans.map(spanBlock),
  ].join('\n');

  fs.writeFileSync(contextPath, body, 'utf8');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  return { contextPath, receiptPath };
}

export function buildReceipt(input: {
  task: string;
  budgetLines: number;
  spans: SelectedSpan[];
  filesRejected: number;
  excludedForSecrets: number;
  retrievalMs: number;
}): Receipt {
  const tokensUsed = input.spans.reduce((n, s) => n + s.tokens, 0);
  const filesSelected = new Set(input.spans.map((s) => s.path)).size;

  return {
    task: input.task,
    budgetLines: input.budgetLines,
    tokensUsed,
    filesSelected,
    filesRejected: input.filesRejected,
    excludedForSecrets: input.excludedForSecrets,
    retrievalMs: input.retrievalMs,
    spans: input.spans,
  };
}
