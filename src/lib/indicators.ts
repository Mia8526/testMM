/**
 * Utility functions for technical indicators.
 */

/**
 * Calculates Simple Moving Average (SMA)
 * @param prices Array of prices (numbers)
 * @param period The SMA period (e.g., 50, 200)
 * @returns The SMA value or null if insufficient data
 */
export function calculateSMA(prices: (number | null | undefined)[], period: number): number | null {
  if (!prices || !Array.isArray(prices) || period <= 0) return null;

  const validPrices = prices.filter((p): p is number => typeof p === 'number' && !isNaN(p));
  
  if (validPrices.length < period) return null;
  
  const slice = validPrices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Calculates Exponential Moving Average (EMA)
 * @param prices Array of prices (numbers)
 * @param period The EMA period
 * @returns The EMA value or null if insufficient data
 */
export function calculateEMA(prices: (number | null | undefined)[], period: number): number | null {
  if (!prices || !Array.isArray(prices) || period <= 0) return null;

  const validPrices = prices.filter((p): p is number => typeof p === 'number' && !isNaN(p));

  if (validPrices.length < period) return null;

  const multiplier = 2 / (period + 1);
  
  // Use SMA as the initial value for the first EMA calculation point
  const firstPeriod = validPrices.slice(0, period);
  let ema = firstPeriod.reduce((a, b) => a + b, 0) / period;

  // Process from the end of the first period to the last price
  for (let i = period; i < validPrices.length; i++) {
    ema = (validPrices[i] - ema) * multiplier + ema;
  }

  return ema;
}
