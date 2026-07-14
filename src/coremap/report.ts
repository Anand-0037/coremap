import type { Receipt } from './types.js';

export interface ReportExtras {
  fullTokens: number;
  compressTokens: number;
  relevantSpansEarly: string;
  hitFile?: number;
  hitRegion?: number;
}

function yn(v: boolean | null | undefined, skipped?: boolean): string {
  if (skipped) return 'skipped';
  if (v === null || v === undefined) return '—';
  return v ? 'yes' : 'no';
}

/**
 * Print baseline-vs-CoreMap table (Full / Compress / CoreMap).
 * Full = everything an agent would otherwise dump from the walked repo.
 * Compress = signature-only baseline (token count only).
 * Full/Compress "Tests passed" = unpatched-repo test run (same baseline).
 */
export function printReport(receipt: Receipt, extras: ReportExtras): void {
  const verify = receipt.verify;
  const coreSkipped = Boolean(verify?.skippedReason && !verify.patchProduced);
  const oracle = Boolean(verify?.skippedReason?.includes('oracle'));
  const baselineLabel = yn(receipt.baseline?.testsPassed);

  const rows: Array<[string, string, string, string]> = [
    [
      'Context tokens',
      String(extras.fullTokens),
      String(extras.compressTokens),
      String(receipt.tokensUsed),
    ],
    [
      'Relevant spans early',
      '0/?',
      '0/?',
      extras.relevantSpansEarly || '—',
    ],
    [
      'HitFile',
      '—',
      '—',
      extras.hitFile == null ? '—' : extras.hitFile.toFixed(2),
    ],
    [
      'HitRegion≈',
      '—',
      '—',
      extras.hitRegion == null ? '—' : extras.hitRegion.toFixed(2),
    ],
    [
      'Patch produced',
      'no',
      'no',
      verify ? yn(verify.patchProduced, coreSkipped && !oracle) : '—',
    ],
    [
      // Unpatched-repo tests (shared baseline for Full + Compress columns)
      'Tests (unpatched)',
      baselineLabel,
      baselineLabel,
      verify ? yn(verify.testsPassed, verify.testsPassed == null) : '—',
    ],
    ['Evidence trace', 'no', 'no', 'yes'],
  ];

  const w0 = Math.max(20, ...rows.map((r) => r[0].length));
  const w1 = Math.max(8, ...rows.map((r) => r[1].length), 'Full'.length);
  const w2 = Math.max(8, ...rows.map((r) => r[2].length), 'Compress'.length);
  const w3 = Math.max(8, ...rows.map((r) => r[3].length), 'CoreMap'.length);

  const line = (a: string, b: string, c: string, d: string) =>
    `${a.padEnd(w0)}  ${b.padStart(w1)}  ${c.padStart(w2)}  ${d.padStart(w3)}`;

  console.log('');
  console.log(line('', 'Full', 'Compress', 'CoreMap'));
  console.log(line('-'.repeat(w0), '-'.repeat(w1), '-'.repeat(w2), '-'.repeat(w3)));
  for (const row of rows) {
    console.log(line(...row));
  }
  console.log('');
  console.log(
    'note: Full = all walked text an agent might dump; Compress = signatures only;',
  );
  console.log(
    '      Tests (unpatched) = same baseline run on the unbroken/unpatched repo copy.',
  );
  console.log('');

  const tokenWin = receipt.tokensUsed < extras.fullTokens;
  const hitWin = (extras.hitFile ?? 0) >= 0.99;
  const testWin = verify?.testsPassed === true;
  if (tokenWin && (hitWin || testWin)) {
    const parts = [
      tokenWin ? `tokens ${extras.fullTokens}→${receipt.tokensUsed}` : null,
      hitWin ? `HitFile=${(extras.hitFile ?? 0).toFixed(2)}` : null,
      extras.hitRegion != null ? `HitRegion≈${extras.hitRegion.toFixed(2)}` : null,
      testWin ? 'tests=PASS' : null,
    ].filter(Boolean);
    console.log(`coremap: GREEN DELTA  ${parts.join('  |  ')}`);
    console.log('');
  }
}
