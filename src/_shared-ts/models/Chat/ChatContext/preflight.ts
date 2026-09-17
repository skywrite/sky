import { noul, type TypeSafeClient } from '@typesafe-ai/sdk'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { PreflightVerdict } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ConversationMessage } from '../type.d.ts'

/**
 * The preflight: Jev reads the message before Sky does and says how likely
 * it is that answering needs the notebook. A message any assistant could
 * answer — general knowledge, editing text already in the conversation,
 * code, small talk — reads nothing new; everything else reads as it does
 * today. The verdict is a probability, and the line it is held to sits low
 * on purpose: a wrong skip answers without the notebook, a wrong read
 * costs what every turn costs today.
 */
export const SKIP_BELOW = 0.2
/** How much of each recent turn the judge sees — enough to tell what the conversation is about. */
const TURN_CHARS = 400
const RECENT_TURNS = 4

/** A verdict for a message, or null when no preflight ran. */
export type Preflight = (message: string, recent: ConversationMessage[]) => Promise<PreflightVerdict | null>

const NEEDS_NOTEBOOK = noul(
  'Does answering `message` need the person’s own notebook — their notes, journal, meetings, saved messages and emails, people, projects, plans, files, or any fact about their own life and work? `recent_turns` is the conversation so far, newest last; a follow-up that continues work on something taken from the notebook still needs it.',
  {
    true: 'The answer depends on what the person has recorded or done: their notes, records, history, people, schedule, or files. Asking about “my” anything, naming a person or project of theirs, asking what happened or what is coming up.',
    false:
      'Any assistant could answer without knowing the person: general knowledge, explanations, writing or editing text that is already in the conversation, code, math, translation, small talk.',
  },
)

/** A preflight over a TypeSafe client. Test seams: `now` for the timing, `sink` for where the usage record goes. */
export function contextPreflight(
  client: TypeSafeClient,
  options: { now?: () => number; sink?: (record: AIUsageRecord) => void | Promise<void> } = {},
): Preflight {
  const now = options.now ?? (() => performance.now())
  return async (message, recent) => {
    const started = now()
    const result = await askTypeSafe(
      client,
      {
        state: {
          message,
          recent_turns: recent.slice(-RECENT_TURNS).map((turn) => ({
            who: turn.role === 'user' ? 'person' : 'sky',
            said: turn.content.slice(0, TURN_CHARS),
          })),
        },
        questions: { needs_notebook: NEEDS_NOTEBOOK },
      },
      options.sink ? { sink: options.sink } : {},
    )
    const needsNotebook = result.answers.needs_notebook.noul
    return { needsNotebook, skipped: needsNotebook < SKIP_BELOW, model: result.model, ms: Math.round(now() - started) }
  }
}
