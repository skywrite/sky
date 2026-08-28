import { keepNever, type Scorer } from '../mod.ts'

/**
 * Wrap any scorer so that specific paths always get a `keep: 'never'`
 * verdict — kept out whatever the scorer says. Composed outside
 * `withPinnedPaths`, an exclusion outranks a pin: the person's "not this
 * one" is the last word.
 */
export function withExcludedPaths(scorer: Scorer, excludedPaths: ReadonlySet<string>, reason = 'excluded'): Scorer {
  if (excludedPaths.size === 0) return scorer
  return (item) => (excludedPaths.has(item.path) ? keepNever(reason) : scorer(item))
}
