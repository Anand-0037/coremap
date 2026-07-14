import fs from 'node:fs';
import type { SelectedSpan } from './types.js';

export interface GroundTruthRegion {
  path: string;
  lineStart: number;
  lineEnd: number;
}

export interface GroundTruth {
  files: string[];
  regions: GroundTruthRegion[];
}

/**
 * Parse a unified diff into changed files + approximate line regions.
 * Only used AFTER selection for HitFile/HitRegion — never as ranking input.
 */
export function parseGroundTruthPatch(patchText: string): GroundTruth {
  const files = new Set<string>();
  const regions: GroundTruthRegion[] = [];
  let currentPath: string | null = null;
  let newLine = 0;
  let hunkStart = 0;
  let inHunk = false;
  let lastTouched = 0;

  const flush = () => {
    if (currentPath && inHunk && lastTouched >= hunkStart) {
      regions.push({
        path: currentPath,
        lineStart: hunkStart,
        lineEnd: lastTouched,
      });
    }
  };

  for (const raw of patchText.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      flush();
      inHunk = false;
      const p = raw.slice(4).trim().replace(/^b\//, '');
      if (p !== '/dev/null') {
        currentPath = p;
        files.add(p);
      } else {
        currentPath = null;
      }
      continue;
    }
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      flush();
      newLine = Number(hunk[2]);
      hunkStart = newLine;
      lastTouched = newLine;
      inHunk = true;
      continue;
    }
    if (!inHunk || !currentPath) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lastTouched = newLine;
      newLine += 1;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // deletion: region stays around hunkStart/lastTouched
      lastTouched = Math.max(lastTouched, newLine);
    } else if (raw.startsWith(' ') || raw === '') {
      lastTouched = newLine;
      newLine += 1;
    }
  }
  flush();

  // Merge overlapping regions per file
  const byFile = new Map<string, GroundTruthRegion[]>();
  for (const r of regions) {
    const list = byFile.get(r.path) ?? [];
    list.push(r);
    byFile.set(r.path, list);
  }
  const merged: GroundTruthRegion[] = [];
  for (const [p, list] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.lineStart - b.lineStart);
    let cur = { ...list[0]! };
    for (let i = 1; i < list.length; i++) {
      const n = list[i]!;
      if (n.lineStart <= cur.lineEnd + 1) {
        cur.lineEnd = Math.max(cur.lineEnd, n.lineEnd);
      } else {
        merged.push(cur);
        cur = { ...n };
      }
    }
    merged.push(cur);
    void p;
  }

  return {
    files: [...files].sort((a, b) => a.localeCompare(b)),
    regions: merged,
  };
}

export function loadGroundTruth(patchPath: string): GroundTruth {
  const text = fs.readFileSync(patchPath, 'utf8');
  return parseGroundTruthPatch(text);
}

function lineOverlap(
  a: { lineStart: number; lineEnd: number },
  b: { lineStart: number; lineEnd: number },
): number {
  const start = Math.max(a.lineStart, b.lineStart);
  const end = Math.min(a.lineEnd, b.lineEnd);
  return Math.max(0, end - start + 1);
}

/**
 * HitFile = |selected ∩ truth files| / |truth files|
 * HitRegion = overlapped truth lines / total truth lines
 */
export function computeHitMetrics(
  spans: SelectedSpan[],
  truth: GroundTruth,
): { hitFile: number; hitRegion: number; relevantSpansEarly: string } {
  if (truth.files.length === 0) {
    return { hitFile: 0, hitRegion: 0, relevantSpansEarly: '0/0' };
  }

  const selectedFiles = new Set(spans.map((s) => s.path));
  const hitFiles = truth.files.filter((f) => selectedFiles.has(f));
  const hitFile = hitFiles.length / truth.files.length;

  let truthLines = 0;
  let overlapped = 0;
  for (const region of truth.regions) {
    const regionLines = region.lineEnd - region.lineStart + 1;
    truthLines += regionLines;
    const fileSpans = spans.filter((s) => s.path === region.path);
    let covered = 0;
    for (let line = region.lineStart; line <= region.lineEnd; line++) {
      if (fileSpans.some((s) => line >= s.lineStart && line <= s.lineEnd)) {
        covered += 1;
      }
    }
    overlapped += covered;
    void lineOverlap;
  }
  const hitRegion = truthLines === 0 ? 0 : overlapped / truthLines;

  // Relevant spans early: how many truth files appear in first N ranks
  const earlyN = Math.min(5, spans.length);
  const earlyFiles = new Set(spans.slice(0, earlyN).map((s) => s.path));
  const earlyHits = truth.files.filter((f) => earlyFiles.has(f)).length;
  const relevantSpansEarly = `${earlyHits}/${truth.files.length}`;

  return {
    hitFile: round4(hitFile),
    hitRegion: round4(hitRegion),
    relevantSpansEarly,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
