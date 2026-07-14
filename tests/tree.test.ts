import { describe, expect, it } from 'vitest';
import { renderTree } from '../src/coremap/tree.js';

describe('renderTree', () => {
  it('renders a fixed nested ASCII tree', () => {
    const out = renderTree(
      [
        { path: 'package.json' },
        { path: 'src/cli.ts' },
        { path: 'src/index.ts' },
      ],
      'repo',
    );
    expect(out).toBe(
      [
        'repo/',
        '├── src/',
        '│   ├── cli.ts',
        '│   └── index.ts',
        '└── package.json',
      ].join('\n'),
    );
  });
});
