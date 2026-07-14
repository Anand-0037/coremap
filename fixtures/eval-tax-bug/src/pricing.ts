/**
 * Pricing helpers for checkout.
 * Bug (pinned eval): calculateTotal ignores taxRate.
 */
export function addTax(subtotal: number, taxRate: number): number {
  return subtotal + subtotal * taxRate;
}

export function calculateTotal(items: number[], taxRate: number): number {
  const subtotal = items.reduce((sum, n) => sum + n, 0);
  // BUG: taxRate is ignored — should call addTax(subtotal, taxRate)
  return subtotal;
}

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
