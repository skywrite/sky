// [pattern, probability, question, subQuestions?]
// pattern: Recurring pattern from _shared-ts/universal/dates/recurring/patterns.ts (e.g., 'EVERY-DAY', 'EVERY-MON', 'MONTHLY-1')
// probability: 0.0-1.0 chance of appearing when pattern matches
export type Question = [string, number, string, Array<Question>?]

export type JournalType =
  | 'Accountability'
  | 'Execution'
  | 'Gratitude'
  | 'Health'
  | 'Leadership'
  | 'Lessons Learned'
  | 'Markets'
  | 'Misc'
  | 'Mood'
  | 'News'
  | 'Relationships'
  | 'Self Improvement'
  | 'Surprises'
  | 'Values'
  | (string & {})

export type JournalOptions = {
  type: JournalType
  randomFunc?: () => number
}
