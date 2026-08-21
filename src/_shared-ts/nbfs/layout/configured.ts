import { NBFS_LAYOUT } from '#config'
import { DEFAULT_LAYOUT_PATTERN, layoutByPattern } from './registry.ts'
import type { NbfsLayout } from './types.ts'

/**
 * The layout this notebook speaks, selected by nbfs.layout in config. The
 * config loader validates the pattern against the registry and falls back
 * to the default, so the lookup cannot miss; the fallback here just makes
 * that contract local.
 */
const configured: NbfsLayout = layoutByPattern(NBFS_LAYOUT) ?? (layoutByPattern(DEFAULT_LAYOUT_PATTERN) as NbfsLayout)

export default configured
