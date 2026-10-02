export interface JournalSource {
  path: string
  title: string
  quote: string
}

export interface ReflectionQuestion {
  /** Stable ordinal within the private session. */
  id: string
  text: string
  origin: 'regular' | 'ai' | 'followup'
  basedOn?: string
  published?: boolean
  /** Hidden from the session without removing any saved writing. */
  dismissed?: boolean
}

export interface Reflection {
  id: string
  title: string
  journalType?: string
  summary?: string
  /** Fingerprint of the writing last enriched; no processing state goes into the notebook file. */
  enriched?: string
  staple: boolean
  observation: string
  sources: JournalSource[]
  questions: ReflectionQuestion[]
  skipped?: boolean
  coveredBy?: string
  file?: string
  /** Publication order disambiguates repeated question headings without annotating the Markdown. */
  sections?: string[]
  /** A durable reservation lets a lost response recover a first save without duplicating it. */
  allocation?: { file: string; content: string }
  rename?: {
    from: string
    to: string
    original: string
    content: string
    summary: string
    journalType: string
    enriched?: string
  }
}

export type JournalAction = 'prepare' | 'deeper' | 'reframe'
export interface JournalOperation {
  id: string
  action: JournalAction
  topic?: string
  status: 'running' | 'complete' | 'failed'
  stage: string
  error?: string
}

export interface JournalSession {
  id: string
  day: string
  created: string
  time: string
  current: string
  topics: Reflection[]
  prepared: boolean
  operation?: JournalOperation
  completed: string[]
}

export interface JournalView {
  /** The browser bundle can update before an idle-gated server reload. */
  namingAvailable?: boolean
  session: JournalSession | null
  answers: Record<string, Record<string, string>>
  problems: Record<string, string>
}

export interface JournalPaths {
  notebookDir: string
  timeDir: string
  stateDir: string
}

export interface JournalCandidate {
  title: string
  journalType?: string
  question: string
  observation: string
  sources: JournalSource[]
}

export interface JournalEnrichment {
  tags?: string
  rel?: string[]
}

export interface JournalAI {
  name?(topic: Reflection, answers: Record<string, string>): Promise<{ summary: string; journalType: string }>
  enrich?(input: { summary: string; body: string; existingRel: string[] }): Promise<JournalEnrichment>
  prepare(session: JournalSession, progress: (stage: string) => Promise<void>): Promise<JournalCandidate[]>
  followup(input: {
    session: JournalSession
    topic: Reflection
    answers: JournalView['answers']
    reframe: boolean
  }): Promise<{ question: string | null; covered: string[] }>
}

export class JournalError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message)
  }
}
