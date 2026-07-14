import { calculateTotal } from './billing.js';

export function checkout(cart: number[]): number {
  return calculateTotal(cart, 0.08);
}
