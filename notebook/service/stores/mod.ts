/**
 * Store configuration types for the notebook service.
 */

/**
 * Configuration for building MarkdownStore.
 * Used by server tests that pass custom fixture directories.
 * Production uses MarkdownStore.buildFromAll() instead.
 */
export interface MarkdownStoreConfig {
  peopleDirs: string[]
  orgDirs: string[]
  projectsDir?: string
  decisionsDir?: string
  goalsDir?: string
  ideasDir?: string
  placesDir?: string
  timeDirs?: string[]
}
