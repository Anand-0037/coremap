export function addTax(price: number, rate: number): number {
  return price + price * rate;
}

export function calculateTotal(items: number[], taxRate: number): number {
  const subtotal = items.reduce((a, b) => a + b, 0);
  return addTax(subtotal, taxRate);
}
