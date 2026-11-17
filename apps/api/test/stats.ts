/**
 * Pearson's chi-square goodness-of-fit statistic: how far the observed counts are from
 * what the expected proportions predict. A large value means "this is not the distribution
 * we asked for".
 */
export function chiSquare(observed: number[], expectedProportions: number[]): number {
  const total = observed.reduce((sum, count) => sum + count, 0);
  return observed.reduce((sum, count, i) => {
    const expected = total * expectedProportions[i];
    return sum + (count - expected) ** 2 / expected;
  }, 0);
}

/**
 * Critical values of the chi-square distribution at p = 0.001, by degrees of freedom.
 * A correct, unbiased implementation exceeds them only 1 time in 1,000.
 */
export const CRITICAL_VALUE_P001: Record<number, number> = {
  1: 10.828,
  2: 13.816,
  3: 16.266,
  4: 18.467,
};
