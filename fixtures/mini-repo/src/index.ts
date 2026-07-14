import { checkout } from './src/checkout.js';

export function main(): void {
  const total = checkout([10, 20, 5]);
  console.log(total);
}

main();
