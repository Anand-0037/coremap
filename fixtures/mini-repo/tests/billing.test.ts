import { describe, it, expect } from 'vitest';
import { calculateTotal } from '../src/billing.js';

describe('calculateTotal', () => {
  it('applies tax', () => {
    expect(calculateTotal([100], 0.1)).toBe(110);
  });
});
