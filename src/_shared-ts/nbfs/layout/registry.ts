import type { NbfsLayout } from './types.ts'
import v1_1 from './v1_1/mod.ts'
import { v2, v2Months } from './v2.ts'

/**
 * The default describes what a notebook's tree IS: v2, YYYY/W##/MM-DD, since
 * 2026-08-30. A notebook still in v1.1 selects it in config (nbfs.layout) or
 * moves with nbfs:migrate.
 */
export const DEFAULT_LAYOUT_PATTERN = v2.pattern

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
