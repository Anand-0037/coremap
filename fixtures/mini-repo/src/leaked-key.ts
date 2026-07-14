// Fake leaked key for secret-scan fixture — must never appear in a context pack.
export const DEMO_OPENAI_KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';

export function unused(): string {
  return DEMO_OPENAI_KEY;
}
