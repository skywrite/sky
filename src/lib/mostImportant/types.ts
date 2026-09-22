import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface MISuggestion {
  summary: string
  reason: string
}

export interface MISuggestions {
  contextSummary: string
  suggestions: MISuggestion[]
}

export interface MIAnswer {
  question: string
  answer: string
}

export interface MIDraft {
  summary: string
  /** Optional deadline, never a scheduled start time. */
  dueBy: string
  /** Editable Markdown beneath the title and optional deadline. */
  body: string
}

export interface MIInterview {
  statement: string
  answers: MIAnswer[]
}

export interface MIDraftInput extends MIInterview {
  previous?: MIDraft
  feedback?: string
}

/** Stages advance only when the underlying work advances, never on a UI timer. */
export interface MIProgress {
  stage: 'context' | 'thinking' | 'writing' | 'saving'
  documents?: number
}
export type MIProgressReporter = (progress: MIProgress) => void

export interface MostImportantAI {
  suggest(
    day: PlainDate,
    options?: { previous?: MISuggestion[]; feedback?: string },
    progress?: MIProgressReporter,
  ): Promise<MISuggestions>
  question(day: PlainDate, input: MIInterview, progress?: MIProgressReporter): Promise<string | null>
  draft(day: PlainDate, input: MIDraftInput, progress?: MIProgressReporter): Promise<MIDraft>
  enrich?(draft: MIDraft): Promise<{ tags?: string; rel?: string[] }>
}

export const MAX_MI_QUESTIONS = 3

export class MostImportantError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message)
  }
}
