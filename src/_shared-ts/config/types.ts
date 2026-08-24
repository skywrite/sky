export interface AiProfileConfig {
  provider: string
  model: string
  baseUrl?: string
  options?: Record<string, unknown>
}

export interface SkyConfig {
  version: number
  dir: string
  userDataDir: string
  codeDir: string
  /** Where commands look for user-dropped files when a --from-* flag omits its path (default: ~/Desktop). */
  inputDir: string
  /** Where commands write files for the user — generated images, PDF exports, saved transcripts (default: ~/Desktop). */
  outputDir: string
  editor: string | undefined
  categories: string[]
  commands: {
    dirs: string[]
    day: {
      start: string[]
      end: string[]
    }
  }
  bins: Record<string, string>
  slack: {
    workspace?: string
  }
  ai: {
    models: {
      strong: string
      fast: string
      transcription: string
    }
    profiles?: Record<string, AiProfileConfig>
  }
  server: {
    port: number
  }
  nbfs: {
    /** Time-tree layout pattern (e.g. "YYYY/W##/MM-DD") - see nbfs/layout. */
    layout: string
  }
}
