/**
 * Build a nested ASCII directory tree from relative paths.
 * Pure + deterministic — no fs access.
 */
export function renderTree(files: Array<{ path: string }>, rootLabel = 'repo'): string {
  type Node = { name: string; children: Map<string, Node>; isFile: boolean };
  const root: Node = { name: rootLabel, children: new Map(), isFile: false };

  const paths = [...files].map((f) => f.path).sort((a, b) => a.localeCompare(b));
  for (const rel of paths) {
    const parts = rel.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, children: new Map(), isFile };
        cur.children.set(part, next);
      }
      cur = next;
    }
  }

  const lines: string[] = [`${rootLabel}/`];

  function walk(node: Node, prefix: string): void {
    const kids = [...node.children.values()].sort((a, b) => {
      // dirs before files, then alpha
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    kids.forEach((child, idx) => {
      const last = idx === kids.length - 1;
      const branch = last ? '└── ' : '├── ';
      const label = child.isFile ? child.name : `${child.name}/`;
      lines.push(`${prefix}${branch}${label}`);
      if (!child.isFile && child.children.size > 0) {
        walk(child, prefix + (last ? '    ' : '│   '));
      }
    });
  }

  walk(root, '');
  return lines.join('\n');
}
