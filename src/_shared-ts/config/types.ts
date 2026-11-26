/** The side of the day file a Google account's saved mail is filed under. */
export type GoogleAccountCategory = 'Professional' | 'Personal'

/** Where saved items from email (Sky/Follow) and Slack saved open after capture. */
export type OpenSavedTarget = 'browser' | 'code' | 'none'

export interface AiProfileConfig {
  provider: string
  model: string
  baseUrl?: string
  contextWindow?: number
  options?: Record<string, unknown>
}

/** What Sky lands in the day from Slack on its own: direct messages, mentions and thread replies, the owner's own messages. */
export type SlackForYou = { dms: boolean; mentions: boolean; own: boolean }

/** Automatic rollover and expiry for daily reminders on day:start. */
export interface RemindersConfig {
  /** Move unfinished reminders from recent unclosed past days onto Today on day:start (default: true). */
  autoRollover: boolean
  /** Delete reminders untouched for this many days on day:start; 0 disables automatic expiry (default: 3). */
  expireDays: number
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
  /** Where saved items from email (Sky/Follow) and Slack saved open after capture (default: 'browser'). */
  openSavedIn?: OpenSavedTarget
  categories: string[]
  commands: {
    dirs: string[]
    day: {
      start: string[]
    }
  }
  bins: Record<string, string>
  slack: {
    workspace?: string
    /** Filled in by the loader; see slackForYou() for the defaults */
    forYou?: SlackForYou
  }
  calendar?: {
    /** Separate meeting invitations from informational events using Jev. */
    classifyEvents?: boolean
  }
  google?: {
    /** Each account's category, by its email in lower case; an account not listed files as Professional. */
    accountCategories?: Record<string, GoogleAccountCategory>
  }
  /** The web pages' own preferences — the settings page writes these. */
  web: {
    theme?: 'system' | 'light' | 'dark'
    textSize?: 'default' | 'large'
  }
  /** Morning review only; starting and ending remain explicit. Zero disables the automatic prompt. */
  dayReview?: { idleHours: number }
  /** Daily reminder rollover and automatic expiry on day:start. */
  reminders?: RemindersConfig
  voice: {
    /** The voice Sky uses in browser calls; unset means the built-in default. */
    voice?: string
  }
  /** Features still taking shape — the Experimental page's switches. */
  experimental: {
    /** Show Workstreams in the app sidebar; hidden unless explicitly enabled. */
    workstreams?: boolean
    /** Show Outbox in the app sidebar; hidden unless explicitly enabled. */
    outbox?: boolean
    /** Before a web chat reads the notebook, TypeSafe's Jev judges whether the message needs it. */
    contextPreflight?: boolean
    /** `sky browser:task`: TypeSafe's Jev picks each move in the browser (the default); false hands the browser to the reasoning model. */
    jevBrowser?: boolean
  }
  ai: {
    models: {
      strong: string
      fast: string
      transcription: string
    }
    profiles?: Record<string, AiProfileConfig>
    /** Each role chooses a named preset from ai.profiles or the built-in catalog. */
    roles?: Partial<Record<'chat' | 'frontier' | 'reasoning' | 'fast' | 'balanced' | 'vision', string>>
    /** Decision model configurations (provider + model) for structured decision calls. */
    decisionProfiles?: Record<string, AiProfileConfig>
    /** Each decision role chooses a named preset from ai.decisionProfiles or the built-in catalog. */
    decisionRoles?: Partial<Record<'default', string>>
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
