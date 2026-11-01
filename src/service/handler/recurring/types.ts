export const SOURCES = ['professional', 'personal', 'reminders'] as const
export type RecurringSource = (typeof SOURCES)[number]
export type RecurringKind = 'todo' | 'commitment' | 'reminder'
export type RecurringCategory = 'Professional' | 'Personal'

export interface RecurringDraft {
  text: string
  notes: string
  kind: RecurringKind
  category: RecurringCategory
  time: string
  pattern: string
}

export interface RecurringItem extends RecurringDraft {
  /** An address in the reviewed file, not a persisted content identity. */
  id: string
  source: RecurringSource
  valid: boolean
  dates: string[]
}

export interface RecurringFile {
  source: RecurringSource
  path: string
  exists: boolean
  revision: string
}

export interface RecurringReport {
  today: string
  items: RecurringItem[]
  files: RecurringFile[]
}

export interface RecurringSave {
  id?: string
  revisions: Record<RecurringSource, string>
  draft: RecurringDraft
}
