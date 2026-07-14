import { getEncoding, type Tiktoken } from 'js-tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    // o200k_base — current OpenAI coding models; deterministic + sync
    encoder = getEncoding('o200k_base');
  }
  return encoder;
}

/** Exact token count via js-tiktoken (o200k_base). Deterministic. */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return getEncoder().encode(text).length;
}
