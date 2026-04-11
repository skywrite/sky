/**
 * Format numbers to 3 significant figures or 3 decimal places
 *
 * - For values >= 1: Uses 3 decimal places (e.g., 123.456 → 123.456)
 * - For values < 1: Uses 3 significant figures (e.g., 0.0000377 → 0.0000377)
 *
 * This is particularly useful for financial data where small values
 * (like micro-cap cryptocurrencies) need meaningful precision.
 *
 * @param num - The number to format
 * @returns The formatted number
 *
 * @example
 * ```ts
 * formatNumber(112002.10)    // 112002.100
 * formatNumber(3822.21)      // 3822.210
 * formatNumber(0.0000377)    // 0.0000377
 * formatNumber(0.0113)       // 0.0113
 * ```
 */
export function formatNumber(num: number): number {
  if (num >= 1) {
    // For prices >= $1, use 3 decimal places
    return parseFloat(num.toFixed(3))
  } else {
    // For prices < $1, use 3 significant figures
    return parseFloat(num.toPrecision(3))
  }
}
