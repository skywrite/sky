import { keepAlways, type Scorer } from '../mod.ts'

/**
 * Wrap any scorer so that specific paths always get a `keep: 'always'`
 * verdict (kept unconditionally, never pruned).
 * Composes with any scorer — the caller decides what's pinned.
 */
export function withPinnedPaths(scorer: Scorer, pinnedPaths: ReadonlySet<string>): Scorer {
  if (pinnedPaths.size === 0) return scorer
  return (item) => (pinnedPaths.has(item.path) ? keepAlways('pinned') : scorer(item))
}
