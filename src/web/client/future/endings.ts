import type { FutureEnding } from '../../../service/handler/future/types.ts'

/** The three ways a goal ends, in the order they are offered, with what each means. */
export const ENDINGS: Array<{ ending: FutureEnding; label: string; meaning: string }> = [
  { ending: 'reached', label: 'Reached', meaning: 'You got there.' },
  { ending: 'missed', label: 'Missed', meaning: 'You went for it and fell short.' },
  { ending: 'dropped', label: 'Dropped', meaning: 'You stopped going after it.' },
]

export const ENDING_LABEL: Record<FutureEnding, string> = { reached: 'Reached', missed: 'Missed', dropped: 'Dropped' }
