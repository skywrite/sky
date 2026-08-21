import type { NbfsLayout } from './types.ts'
import v1_1 from './v1_1.ts'
import { v2, v2Months } from './v2.ts'

/**
 * The default follows what existing notebooks speak today. It flips to v2
 * (YYYY/W##/MM-DD, the ruled end state) when the migration ships.
 */
export const DEFAULT_LAYOUT_PATTERN = v1_1.pattern

/**
 * Every selectable layout, current generation first. Parse-anything
 * consumers (migration, stale-path resolution) try these in order; config
 * selects exactly one by its pattern string.
 */
export const ALL_LAYOUTS: NbfsLayout[] = [v2, v2Months, v1_1]

/** The pattern strings nbfs.layout accepts in config. */
export const LAYOUT_PATTERNS: string[] = ALL_LAYOUTS.map((l) => l.pattern)

export function layoutByPattern(pattern: string): NbfsLayout | undefined {
  return ALL_LAYOUTS.find((l) => l.pattern === pattern)
}
