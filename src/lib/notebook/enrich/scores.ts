import { PORT_SERVER } from '#config'
import { normalizeEntityName } from './resolve.ts'

/**
 * Interaction scores from the service, keyed by normalized entity name.
 * Undefined when the service is unreachable — resolution proceeds without the
 * prior and abstains more on ambiguity (degrade, never block).
 */
export async function fetchEntityScores(): Promise<Map<string, number> | undefined> {
  try {
    const response = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ peopleWithScores { name score } organizationsWithScores { name score } }' }),
      signal: AbortSignal.timeout(3000),
    })
    const json = (await response.json()) as {
      data?: {
        peopleWithScores?: { name: string; score: number }[]
        organizationsWithScores?: { name: string; score: number }[]
      }
    }
    const map = new Map<string, number>()
    for (const row of [...(json.data?.peopleWithScores ?? []), ...(json.data?.organizationsWithScores ?? [])]) {
      map.set(normalizeEntityName(row.name), row.score)
    }
    return map.size > 0 ? map : undefined
  } catch {
    return undefined
  }
}
