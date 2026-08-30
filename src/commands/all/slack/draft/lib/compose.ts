import open from 'open'
import colors from 'picocolors'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { createDraft, type SlackDraft, slackTs } from './drafts.ts'
import { type DraftResolvers, renderDraftRow, resolveDraftRows } from './rows.ts'

export type ComposeInput = {
  workspace: string
  /** Conversation id, #channel, user id, or link — whatever agent-slack's create accepts */
  target: string
  /** Thread root ts — the draft goes into that thread's reply box; omitted, into the conversation's composer */
  threadTs?: string
  /** Slack mrkdwn as typed in the composer */
  text: string
  timezone: string
  nowMs: number
  /** Open the thread or conversation in Slack once the draft is filed */
  open: boolean
}

export type ComposeOutcome = { report: string; url?: string; draftId?: string }

export type ComposeDeps = {
  create: typeof createDraft
  resolvers?: DraftResolvers
  openUrl: (url: string) => Promise<unknown>
}

const liveDeps: ComposeDeps = { create: createDraft, openUrl: (url) => open(url) }

/**
 * File the text as a draft and print the row slack:draft:list will show for
 * it. Nothing is sent: `agent-slack message draft create` is the only call,
 * and only the session user sees the result — waiting in the thread's reply
 * box or the conversation's composer to be read, edited, and sent by hand.
 */
export async function composeDraft(
  input: ComposeInput,
  output: OutputHandler,
  deps: ComposeDeps = liveDeps,
): Promise<ComposeOutcome | { error: string }> {
  const text = input.text.trim()
  if (!text) return { error: 'The draft has no text' }

  const created = await deps.create(input.workspace, { target: input.target, threadTs: input.threadTs, text })
  if (!created.ok) return { error: created.error }

  // agent-slack echoes Slack's record; without one, show what was filed
  const draft: SlackDraft = created.draft ?? {
    id: '',
    text,
    last_updated_ts: slackTs(input.nowMs),
    date_scheduled: 0,
    file_ids: [],
    destinations: [],
  }
  const [row] = await resolveDraftRows([draft], input.workspace, input.timezone, deps.resolvers)

  output.log('')
  output.log(colors.bold('Draft saved (not sent) — read, edit, and send it in Slack:'))
  for (const line of renderDraftRow(row, 0)) output.log(line)
  if (input.open && row.link) deps.openUrl(row.link).catch(() => undefined)

  const where = input.threadTs ? `a thread in ${row.label}` : row.label
  const report = `Slack draft saved (not sent) in ${where}${row.link ? ` — ${row.link}` : ''}`
  return { report, url: row.link, draftId: draft.id || undefined }
}
