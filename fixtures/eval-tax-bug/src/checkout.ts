import { calculateTotal, formatMoney } from './pricing.js';

export function checkout(cart: number[], taxRate = 0.08): string {
  const total = calculateTotal(cart, taxRate);
  return formatMoney(total);
}
