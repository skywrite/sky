/**
 * Wire-format types for the `agent-slack` CLI's JSON output.
 *
 * These mirror agent-slack's own `CompactSlackMessage` shape — a hand-maintained
 * copy of another tool's contract, so they drift when agent-slack is upgraded.
 * The fixtures in ./fixtures/ exist to catch that drift.
 */

export type AgentSlackFile = {
  id?: string
  name?: string
  mimetype?: string
  mode?: string
  path?: string
  error?: string
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
  /** `message` for a saved or to-do'd message; `reminder` for a to-do typed by hand in Slack */
  item_type?: string
  state?: string
  /** Which of Slack's piles holds the item: `saved` (the Saved section) or `to_do` (the To-dos tab), `completed` once done */
  todo_state?: string
  /** Epoch seconds of the save action (agent-slack maps the API's date_created) */
  date_saved?: number
  /** Epoch seconds of the to-do's reminder, when one is set */
  date_due?: number
  /** thread_ts is set on every threaded message and equals ts only on the thread parent */
  message?: { content?: string; thread_ts?: string; reply_count?: number }
}

export type AgentSlackLaterList = {
  items: AgentSlackLaterItem[]
  counts: {
    /** Both piles together: everything not completed or archived */
    in_progress?: number
    /** The Saved section of Home */
    saved?: number
    /** The To-dos tab */
    todo?: number
    /** To-dos whose reminder has passed */
    overdue?: number
    total?: number
  }
}
