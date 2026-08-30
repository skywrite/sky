import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { oneLine } from '#commands/all/slack/lib/mod.ts'

/** Where a draft posts, as `agent-slack message draft list` reports it. */
export type SlackDraftDestination = {
  channel_id: string
  /** Thread root ts when the draft is a reply into that thread */
  thread_ts?: string
  /** agent-slack's best-effort name: channel name, DM partner's display name, or an mpdm slug */
  channel_name?: string
}

/** A draft as sky reads it off agent-slack's JSON (`message draft list` / `create`). */
export type SlackDraft = {
  id: string
  /** Body in Slack mrkdwn, mentions in wire form (`<@U…>`, `<#C…>`, `<!subteam^S…>`) */
  text: string
  /** Slack ts of the last edit — the list order, and what a delete must echo */
  last_updated_ts: string
  /** Epoch seconds of a scheduled send; 0 for an ordinary draft */
  date_scheduled: number
  file_ids: string[]
  destinations: SlackDraftDestination[]
}

/** Slack's drafts.list caps a page here and offers no cursor; agent-slack passes the cap through as --limit. */
export const DRAFTS_PAGE_LIMIT = 100

export type DraftsPage = { drafts: SlackDraft[]; hasMore: boolean }

/** The agent-slack spawn, injectable for tests. */
export type AgentSlackRun = (
  args: string[],
) => Promise<{ code: number; success: boolean; stdout: string; stderr: string }>

/**
 * The session user's active drafts, most recently edited first — Slack's own
 * order. A full page means the pile may be deeper: the only way to the rest
 * is deleting from this page and asking again.
 */
export async function listActiveDrafts(
  workspace: string,
  run: AgentSlackRun = runAgentSlack,
): Promise<DraftsPage | { error: string }> {
  const result = await run(['message', 'draft', 'list', '--workspace', workspace, '--limit', String(DRAFTS_PAGE_LIMIT)])
  if (!result.success) return { error: describeFailure('agent-slack message draft list', result) }
  const json = parseJson(result.stdout)
  if (!Array.isArray(json?.drafts)) {
    return { error: `Unparseable agent-slack draft list output: ${oneLine(result.stdout, 200)}` }
  }
  const drafts = json.drafts.flatMap((raw) => toDraft(raw) ?? [])
  return { drafts, hasMore: drafts.length >= DRAFTS_PAGE_LIMIT }
}

/** What to file: Slack mrkdwn text, addressed the way agent-slack accepts targets, optionally into a thread. */
export type NewDraft = {
  /** A conversation id, #channel, user id, or Slack link — agent-slack resolves it */
  target: string
  /** Thread root ts — the draft goes into that thread's reply box; omitted, into the composer */
  threadTs?: string
  text: string
}

/**
 * File a draft through `agent-slack message draft create`. Nothing is sent:
 * only the session user sees the result, waiting in the thread's reply box
 * or the conversation's composer. Options go first and `--` closes them, so
 * a body that starts with a dash (a list) is never read as a flag.
 */
export async function createDraft(
  workspace: string,
  draft: NewDraft,
  run: AgentSlackRun = runAgentSlack,
): Promise<{ ok: true; draft?: SlackDraft } | { ok: false; error: string }> {
  const args = ['message', 'draft', 'create', '--workspace', workspace]
  if (draft.threadTs) args.push('--thread-ts', draft.threadTs)
  args.push('--', draft.target, draft.text)
  const result = await run(args)
  if (!result.success) return { ok: false, error: describeFailure('agent-slack message draft create', result) }
  return { ok: true, draft: toDraft(parseJson(result.stdout)?.draft) }
}

/**
 * Delete one draft. The edit ts rides along so agent-slack needn't re-list
 * to find it — Slack requires it for conflict detection.
 */
export async function deleteDraft(
  workspace: string,
  draft: Pick<SlackDraft, 'id' | 'last_updated_ts'>,
  run: AgentSlackRun = runAgentSlack,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const args = ['message', 'draft', 'delete', draft.id, '--workspace', workspace]
  if (draft.last_updated_ts) args.push('--last-updated-ts', draft.last_updated_ts)
  const result = await run(args)
  return result.success
    ? { ok: true }
    : { ok: false, error: describeFailure('agent-slack message draft delete', result) }
}

/** Permalink to where the draft would post: the thread when it targets one, else the conversation. */
export function draftLink(workspace: string, destination: SlackDraftDestination | undefined): string | undefined {
  if (!destination?.channel_id) return undefined
  const base = `${workspace}/archives/${destination.channel_id}`
  return destination.thread_ts ? `${base}/p${destination.thread_ts.replace('.', '')}` : base
}

/** A scheduled send is a draft with a date — deleting it cancels the send, so a clear keeps them. */
export function isScheduled(draft: SlackDraft): boolean {
  return draft.date_scheduled > 0
}

/** Epoch milliseconds as a Slack ts string: seconds, a dot, six digits. */
export function slackTs(epochMs: number): string {
  const seconds = Math.floor(epochMs / 1000)
  const micros = Math.floor((epochMs - seconds * 1000) * 1000)
  return `${seconds}.${String(micros).padStart(6, '0')}`
}

/** agent-slack's draft record as the fields sky reads, or undefined without an id. */
export function toDraft(raw: unknown): SlackDraft | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return undefined
  return {
    id: record.id,
    text: typeof record.text === 'string' ? record.text : '',
    last_updated_ts: typeof record.last_updated_ts === 'string' ? record.last_updated_ts : '',
    date_scheduled: typeof record.date_scheduled === 'number' ? record.date_scheduled : 0,
    file_ids: strings(record.file_ids),
    destinations: Array.isArray(record.destinations) ? record.destinations.flatMap((d) => toDestination(d) ?? []) : [],
  }
}

function toDestination(raw: unknown): SlackDraftDestination | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const channelId = nonEmpty(record.channel_id)
  if (!channelId) return undefined
  return { channel_id: channelId, thread_ts: nonEmpty(record.thread_ts), channel_name: nonEmpty(record.channel_name) }
}

/** The CLI's failure as one line, with the fix named for the errors sky knows. */
function describeFailure(what: string, result: { code: number; stdout: string; stderr: string }): string {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
  const hint = detail.includes('invalid_auth')
    ? ' — credentials expired, run `sky slack:auth`'
    : detail.includes('team_is_restricted')
      ? ' — drafts belong to the organization: point slack.workspace at the enterprise URL (https://<org>.enterprise.slack.com)'
      : ''
  return `${what} failed: ${oneLine(detail, 300)}${hint}`
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
