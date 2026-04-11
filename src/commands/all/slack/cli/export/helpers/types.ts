export type ConversationType = 'channel' | 'dm' | 'group' | 'unknown'

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
