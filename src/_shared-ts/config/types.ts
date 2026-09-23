export interface AiProfileConfig {
  provider: string
  model: string
  baseUrl?: string
  contextWindow?: number
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
  calendar?: {
    /** Separate meeting invitations from informational events using Jev. */
    classifyEvents?: boolean
  }
  /** The web pages' own preferences — the settings page writes these. */
  web: {
    theme?: 'system' | 'light' | 'dark'
    textSize?: 'default' | 'large'
  }
  voice: {
    /** The voice Sky uses in browser calls; unset means the built-in default. */
    voice?: string
    /** The separate notebook researcher's voice on Talk; unset means ash. */
    researcherVoice?: string
  }
  /** Features still taking shape — the Experimental page's switches. */
  experimental: {
    /** Show Workstreams in the app sidebar; hidden unless explicitly enabled. */
    workstreams?: boolean
    /** Before a web chat reads the notebook, TypeSafe's Jev judges whether the message needs it. */
    contextPreflight?: boolean
  }
  ai: {
    models: {
      strong: string
      fast: string
      transcription: string
    }
    profiles?: Record<string, AiProfileConfig>
    /** Each role chooses a named preset from ai.profiles or the built-in catalog. */
    roles?: Partial<Record<'reasoning' | 'fast' | 'balanced' | 'vision', string>>
    /** Model configuration used for writing voice drafting, learning, and compaction. */
    writingVoiceProfile?: string
  }
  server: {
    port: number
  }
  nbfs: {
    /** Time-tree layout pattern (e.g. "YYYY/W##/MM-DD") - see nbfs/layout. */
    layout: string
  }
}
