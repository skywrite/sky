import { noul, type TypeSafeClient } from '@typesafe-ai/sdk'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { PreflightVerdict } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ConversationMessage } from '../type.d.ts'

/**
 * The preflight: Jev reads the message before Sky does and says how likely
 * it is that answering needs the notebook. Two questions, by where the
 * thread is. Before anything has been read: does this need the notebook
 * at all? A message any assistant could answer — general knowledge, code,
 * small talk — reads nothing. After a reading, the model still holds what
 * it read, and a skipped turn keeps that assembly, so the question is
 * whether the message needs anything MORE: a person, record, or message
 * the conversation has not brought in, or a look at the notebook to check
 * something. "Draft it", "send it", "spell that out", "make it shorter"
 * need nothing more. The verdict is a probability, and the line it is held
 * to sits low on purpose: a wrong skip answers without the notebook, a
 * wrong read costs what every turn costs today.
 */
export const SKIP_BELOW = 0.2
/** How much of each recent turn the judge sees — enough to tell what the conversation is about. */
const TURN_CHARS = 400
const RECENT_TURNS = 4

/** What the judge is told about the thread. */
export interface PreflightState {
  /** The model already holds an assembly read from the notebook, so a follow-up is judged on whether it needs more. */
  assembled: boolean
}

/** A verdict for a message, or null when no preflight ran. */
export type Preflight = (
  message: string,
  recent: ConversationMessage[],
  state: PreflightState,
) => Promise<PreflightVerdict | null>

/** Before any reading: does the message need the notebook at all? */
const NEEDS_NOTEBOOK = noul(
  'Does answering `message` need the person’s own notebook — their notes, journal, meetings, saved messages and emails, people, projects, plans, files, or any fact about their own life and work? `recent_turns` is the conversation so far, newest last; a follow-up that continues work on something taken from the notebook still needs it.',
  {
    true: 'The answer depends on what the person has recorded or done: their notes, records, history, people, schedule, or files. Asking about “my” anything, naming a person or project of theirs, asking what happened or what is coming up.',
    false:
      'Any assistant could answer without knowing the person: general knowledge, explanations, writing or editing text that is already in the conversation, code, math, translation, small talk.',
  },
)

/** After a reading: does the message need anything the conversation does not already have? */
const NEEDS_MORE = noul(
  'The conversation in `recent_turns` (newest last) has already read from the person’s notebook, and the assistant still holds everything it read. Does answering `message` need anything more from the notebook: a person, message, meeting, record, date, or file the conversation has not brought in yet, or a look at the notebook to check, find, or confirm something?',
  {
    true: 'It asks about someone or something the conversation has not covered; asks whether a message, reply, or record exists or has arrived; or asks to look something up, check again, or find more.',
    false:
      'It goes on with what the conversation already has: it confirms or approves a proposal, asks to draft, send, or post what was discussed, edits or shortens a reply, asks for an earlier answer to be explained or spelled out, picks between options already laid out, or is small talk.',
  },
)

/** A preflight over a TypeSafe client. Test seams: `now` for the timing, `sink` for where the usage record goes. */
export function contextPreflight(
  client: TypeSafeClient,
  options: { now?: () => number; sink?: (record: AIUsageRecord) => void | Promise<void> } = {},
): Preflight {
  const now = options.now ?? (() => performance.now())
  const ask = options.sink ? { sink: options.sink } : {}
  return async (message, recent, state) => {
    const started = now()
    const seen = {
      message,
      recent_turns: recent.slice(-RECENT_TURNS).map((turn) => ({
        who: turn.role === 'user' ? 'person' : 'sky',
        said: turn.content.slice(0, TURN_CHARS),
      })),
    }
    const question = state.assembled ? 'needs_more' : 'needs_notebook'
    const result = state.assembled
      ? await askTypeSafe(client, { state: seen, questions: { needs_more: NEEDS_MORE } }, ask)
      : await askTypeSafe(client, { state: seen, questions: { needs_notebook: NEEDS_NOTEBOOK } }, ask)
    const answer = 'needs_more' in result.answers ? result.answers.needs_more : result.answers.needs_notebook
    return {
      needsNotebook: answer.noul,
      skipped: answer.noul < SKIP_BELOW,
      question,
      model: result.model,
      ms: Math.round(now() - started),
    }
  }
}
