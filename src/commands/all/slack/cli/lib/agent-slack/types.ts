/**
 * Wire-format types for the `agent-slack` CLI's JSON output.
 *
 * These mirror agent-slack's own `CompactSlackMessage` shape — a hand-maintained
 * copy of another tool's contract, so they drift when agent-slack is upgraded.
 * The fixtures in ./fixtures/ exist to catch that drift.
 */

export type AgentSlackFile = {
  name?: string
  mimetype?: string
  mode?: string
  path: string
}

export type AgentSlackMessage = {
  channel_id: string
  ts: string
  thread_ts?: string
  author?: { user_id?: string }
  content?: string
  files?: AgentSlackFile[]
}

export type AgentSlackUser = {
  display_name?: string
  real_name?: string
  name?: string
}

export type AgentSlackLaterItem = {
  channel_id: string
  channel_name?: string
  ts: string
  state?: string
  /** Epoch seconds of the save action (agent-slack maps the API's date_created) */
  date_saved?: number
  message?: { content?: string; reply_count?: number }
}

export type AgentSlackLaterList = {
  items: AgentSlackLaterItem[]
  counts: { in_progress?: number; total?: number }
}
