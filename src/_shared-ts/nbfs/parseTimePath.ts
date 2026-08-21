import configured from './layout/configured.ts'
import type { TimePathInfo } from './layout/types.ts'

export type { TimePathInfo } from './layout/types.ts'

/**
 * Classify a time-tree document path in the configured layout (nbfs.layout)
 * and derive the date span it covers. Tolerant: returns null on paths
 * outside the time tree or shapes the layout doesn't speak.
 */
export default function parseTimePath(filePath: string): TimePathInfo | null {
  return configured.parseTimePath(filePath)
}
