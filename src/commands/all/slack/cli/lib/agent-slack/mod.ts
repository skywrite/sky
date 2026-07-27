/**
 * Everything that knows the `agent-slack` CLI's JSON wire format.
 *
 * Generic Slack helpers that operate on sky's own normalized shapes live in
 * `#commands/all/slack/lib/mod.ts` instead.
 */

export type { AgentSlackFile, AgentSlackMessage, AgentSlackUser } from './types.ts'
export type { AgentSlackAuthStatus, AgentSlackWhoami } from './auth.ts'
export { parseAuthTest, parseWhoami } from './auth.ts'
export { default as parseUser } from './parseUser.ts'
export { default as collectUserIds } from './collectUserIds.ts'
