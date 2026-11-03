// Exact arithmetic on the decimal strings the API returns (already divided by
// `decimals`). Pure functions so the Node tests can import them; the browser
// has no viem, so the decimal <-> bigint conversion is written here.

/** "12.345" -> 12345000000000000000n for 18 decimals; extra digits are dropped. */
export function parseUnits(value, decimals) {
  const [whole = '0', fraction = ''] = String(value).split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0').slice(0, decimals) || '0');
}

/** 12345000000000000000n -> "12.345": exact, no trailing zeros. */
export function formatUnits(value, decimals) {
  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Adds decimal strings without floating-point error: ["1.1", "2.2"] -> "3.3". */
export function sumAmounts(values, decimals) {
  return formatUnits(values.reduce((sum, value) => sum + parseUnits(value, decimals), 0n), decimals);
}
