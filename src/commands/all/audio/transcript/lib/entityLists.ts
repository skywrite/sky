/**
 * Known-entity name lists for transcript correction, fetched from the local
 * notebook service. Each returns '' when the service is down — the pipeline
 * degrades to no matching rather than failing.
 *
 * Sizing is deliberate: the windowed people list plus all scored orgs and all
 * projects stays a small fraction of a typical transcript's tokens, and score
 * order keeps the strongest candidates first. An unwindowed people list runs
 * several times larger and mostly adds false-phonetic-match surface, not
 * coverage — a bigger haystack for mishearings to spuriously land in.
 */

const GRAPHQL_URL = 'http://localhost:9999/graphql'

interface WithScore {
  name: string
  score: number
  lastInteraction: string | null
}

async function queryService<T>(query: string, field: string): Promise<T[]> {
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!response.ok) return []
    const result = await response.json()
    return result.data?.[field] ?? []
  } catch {
    return []
  }
}

const scoreLine = (entity: WithScore) => `${entity.name} (${Math.floor(entity.score)})`

/** People with any interaction inside the window, strongest first. */
export async function fetchPeople(today: string, monthsBack = 12): Promise<string> {
  const cutoffDate = new Date(`${today}T00:00:00Z`)
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - monthsBack)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  const people = await queryService<WithScore>(
    '{ peopleWithScores { name score lastInteraction } }',
    'peopleWithScores',
  )
  return people
    .filter((p) => p.lastInteraction && p.lastInteraction > cutoff)
    .sort((a, b) => b.score - a.score)
    .map(scoreLine)
    .join('\n')
}

/** Every org with a positive interaction score, strongest first. */
export async function fetchOrgs(): Promise<string> {
  const orgs = await queryService<WithScore>(
    '{ organizationsWithScores { name score lastInteraction } }',
    'organizationsWithScores',
  )
  return orgs
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(scoreLine)
    .join('\n')
}

/** Every project name, any status — old project names still get referenced. */
export async function fetchProjects(): Promise<string> {
  const projects = await queryService<{ name: string }>('{ projects { name } }', 'projects')
  return projects
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b))
    .join('\n')
}
