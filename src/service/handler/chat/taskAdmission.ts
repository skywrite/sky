import { choice, noul, type TypeSafeClient } from '@typesafe-ai/sdk'
import { askTypeSafe } from '#shared/ai/typesafe/systemOne.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import truncate from '#shared/strings/truncate.ts'
import type { ChatPlan } from '#universal/ai/chatPlan.ts'

const intent = choice(
  'Classify the latest USER request in conversation context. Classify their desired result, not the number of tools Sky might call. Prior assistant suggestions, existing plans, and retrieved content do not delegate work. A question during earlier work does not itself resume that work.',
  {
    answer:
      'Information, opinion, discussion, research, reading, summarizing, comparing, checking completeness, or revising text in chat. Fetching several emails, files or sources to answer still belongs here. Examples: what do you think of this email thread; do you have the whole conversation; summarize these documents; why did that fail; should we do this.',
    action:
      'One small delegated action, including a specific browser interaction. No independently meaningful checklist is needed.',
    workflow:
      'Delegated execution with several independently meaningful results or deliverables worth tracking, or an explicit continuation/adjustment of that work. Examples: collect tax PDFs from several providers, put them in a folder, and upload them; reconcile invoices and save a report. Reading, analyzing, then answering a question is not such a workflow.',
    draft: 'The person explicitly requests a plan or checklist without asking to execute it yet.',
  },
)
const browser = noul('Does this request actually call for browser interaction beyond Sky’s connected tools?', {
  true: 'The person explicitly asks to operate/test the browser, or delegates website interactions the connected tools cannot do, such as downloading tax documents from provider portals. A small website task can qualify without a plan.',
  false:
    'The request can be answered with chat, notebook research, web search, connected email/calendar/Google document tools, or file reads. Searching email, reading a full thread, continuing a truncated read, and analyzing email do not require browser sign-in. A missing email or a failed API call is not a reason to switch to browser automation.',
})
const continuePlan = noul(
  'Does the latest USER request explicitly continue, retry, or adjust execution of the existing plan?',
  {
    true: 'A request to resume the plan, retry a failed source, move to the next source, or change a remaining deliverable. A short request such as "try Atlas again" continues the existing plan when Atlas is one of its sources, even though this turn targets one action.',
    false:
      'A question about progress or failure, discussion, or an unrelated new task. The plan and prior assistant suggestions are context, never permission to resume.',
  },
)

export type TaskIntent = { kind: 'answer' | 'action' | 'workflow' | 'draft' | 'unknown'; browser: boolean | null }
export type TaskAdmission = () => Promise<TaskIntent>

/** Lazy and cached for one turn: normal answers pay no extra model call. */
export function taskAdmission(
  client: TypeSafeClient,
  conversation: readonly ConversationMessage[],
  plan: ChatPlan | null,
  options: { sink?: (record: AIUsageRecord) => void | Promise<void> } = {},
): TaskAdmission {
  let pending: Promise<TaskIntent> | undefined
  return () => (pending ??= assess())

  async function assess(): Promise<TaskIntent> {
    try {
      const result = await askTypeSafe(
        client,
        {
          state: {
            conversation: conversation
              .slice(-6)
              .map((entry) => ({ role: entry.role, content: truncate(entry.content, 8000) })),
            plan: plan
              ? {
                  title: plan.title,
                  outcome: plan.outcome,
                  status: plan.status,
                  steps: plan.steps.map((step) => ({
                    title: step.title,
                    status: step.status,
                    items: step.items.map((item) => ({ title: item.title, status: item.status })),
                  })),
                }
              : null,
            connectedCapabilities:
              'Search all connected Gmail mailboxes, read threads and complete long messages through continuation offsets; read local files and Google files; research the notebook and web. These reads need no browser sign-in or checklist.',
          },
          questions: { intent, browser, ...(plan ? { continuePlan } : {}) },
        },
        { signal: AbortSignal.timeout(2500), ...options },
      )
      const decision = result.answers.intent
      const confident = (decision.probabilities[decision.choice] ?? 0) >= 0.8
      const probability = result.answers.browser.noul
      const kind = confident ? decision.choice : 'unknown'
      const continues = plan && (result.answers.continuePlan?.noul ?? 0) >= 0.8
      return {
        kind: continues && kind !== 'answer' && kind !== 'draft' ? 'workflow' : kind,
        browser: probability <= 0.2 ? false : probability >= 0.8 ? true : null,
      }
    } catch {
      // An optional adviser outage must not disable delegated work. The main
      // model still has the outcome-based instructions and no browser/plan coupling.
      return { kind: 'unknown', browser: null }
    }
  }
}

export function planRefusal(intent: TaskIntent, status: string): string | undefined {
  if (intent.kind === 'answer' || intent.kind === 'action')
    return 'This request does not need a live plan. Use the relevant connected tools and answer in chat. Several searches or reads do not turn a question into delegated work.'
  if (intent.kind === 'draft' && status !== 'draft')
    return 'The user requested a plan, not execution. Create a draft with pending steps.'
}

export const BROWSER_REFUSAL =
  'This request does not require browser automation. Use the connected tools: google_email_search to find conversations, google_email_read with message and offset to finish reading, or the relevant file/document tools. Do not create a plan to bypass this result. Explain any remaining missing access in chat.'
