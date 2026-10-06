import { noul, type TypeSafeClient } from '@typesafe-ai/sdk'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { PreflightVerdict } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ConversationMessage } from '../type.d.ts'

/**
 * Jev judges missing notebook information, not whether a request is personal
 * or needs tools. Local files and connected services have their own tools.
 * A skipped turn keeps the existing assembly and still runs the assistant.
 * Skip below 20% before a reading, or 30% once an assembly exists.
 */
const SKIP_BELOW = { needs_notebook: 0.2, needs_more: 0.3 }
/** How much of each recent turn the judge sees — enough to tell what the conversation is about. */
const TURN_CHARS = 400
const RECENT_TURNS = 4

/** What the judge is told about the thread. */
export interface PreflightState {
  /** The model already holds an assembly read from the notebook, so a follow-up is judged on whether it needs more. */
  assembled: boolean
  /** A bounded summary supplied by the host, without another model call or notebook read. */
  task?: {
    title: string
    outcome: string
    status: string
    note: string
    nextSteps: string[]
    resources: { label: string; location: string }[]
  }
}

/** A verdict for a message, or null when no preflight ran. */
export type Preflight = (
  message: string,
  recent: ConversationMessage[],
  state: PreflightState,
) => Promise<PreflightVerdict | null>

const RETRIEVAL_SCOPE =
  'Decide whether handling the latest `message` requires retrieving missing information from Sky’s indexed notebook. ' +
  'The notebook contains saved notes, journals, meeting records, people, projects, and captured messages. ' +
  'Local folders and PDFs, attachments, websites, live email, and connected spreadsheets have separate tools; needing those tools does not itself require notebook retrieval. ' +
  '`recent_turns` contains short excerpts, newest last, not the complete conversation. `task_context`, when present, summarizes the current task and known resources. ' +
  'Absence from these excerpts is not evidence that information is missing. A new name, file, path, date, or fact supplied by the user is input to use, not by itself a reason to search. ' +
  'Skipping retrieval preserves existing conversation context and access to tools, including later notebook lookups. This decision does not authorize or resume actions.'

const RETRIEVAL_ANSWERS = {
  true:
    'Handling the request depends on missing information that notebook retrieval can supply: prior decisions, commitments, preferences, project history, or saved records. ' +
    'Examples: what did we decide in the Atlas meeting; what commitments did I record last week; continue, but first find the requirements in my project notes. ' +
    'A continuation or file task still qualifies when it also needs missing notebook information.',
  false:
    'The conversation, task context, user-provided information, or direct file/service tools suffice without additional notebook records. ' +
    'Examples: continue, the receipt is in Jane/Downloaded; I uploaded it, update the checklist we are using; read this PDF against the checklist already in this chat; open this spreadsheet URL; send the draft; make that shorter; general knowledge. ' +
    'A status update or an instruction to use a known resource does not require searching the notebook just because it concerns the person’s life or a new file.',
}

/** Before any reading: is missing notebook information needed? */
const NEEDS_NOTEBOOK = noul(
  RETRIEVAL_SCOPE + ' No notebook context has been assembled yet. Does this request need notebook retrieval?',
  RETRIEVAL_ANSWERS,
)

/** After a reading: does the message need anything the conversation does not already have? */
const NEEDS_MORE = noul(
  RETRIEVAL_SCOPE +
    ' The conversation has already retrieved notebook context. Does this request need additional notebook records beyond the information already available?',
  RETRIEVAL_ANSWERS,
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
      ...(state.task ? { task_context: state.task } : {}),
    }
    const question = state.assembled ? 'needs_more' : 'needs_notebook'
    const result = state.assembled
      ? await askTypeSafe(client, { state: seen, questions: { needs_more: NEEDS_MORE } }, ask)
      : await askTypeSafe(client, { state: seen, questions: { needs_notebook: NEEDS_NOTEBOOK } }, ask)
    const answer = 'needs_more' in result.answers ? result.answers.needs_more : result.answers.needs_notebook
    return {
      needsNotebook: answer.noul,
      skipped: answer.noul < SKIP_BELOW[question],
      question,
      model: result.model,
      ms: Math.round(now() - started),
    }
  }
}
