import type { AgentSlackUser } from './types.ts'

/**
 * Extract a display name from an agent-slack user response.
 * Prefers real_name > display_name > name (the `name` fallback
 * is needed for Slack Connect users from external orgs).
 */
export default function parseUser(user: AgentSlackUser): string | undefined {
  return user.real_name || user.display_name || user.name || undefined
}
