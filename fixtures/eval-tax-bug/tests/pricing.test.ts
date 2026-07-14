import { describe, expect, it } from 'vitest';
import { addTax, calculateTotal } from '../src/pricing.js';

describe('pricing', () => {
  it('addTax applies rate', () => {
    expect(addTax(100, 0.1)).toBe(110);
  });

  it('calculateTotal applies tax to cart subtotal', () => {
    // 100 + 10% tax => 110
    expect(calculateTotal([40, 60], 0.1)).toBe(110);
  });
});
