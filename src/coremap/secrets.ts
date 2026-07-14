/**
 * Content-level secret scanner (deterministic).
 * Path-based exclusion lives in walker; this catches secrets inside normal source files.
 */

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{16,}['"]/i,
];

export function contentLooksSecret(content: string): boolean {
  for (const re of PATTERNS) {
    if (re.test(content)) return true;
  }
  return false;
}
