type ContextEntry = { source: string; body: string }
export type VoiceEntityFetcher = (input: string, init: RequestInit) => Promise<Response>

export interface VoiceEntities {
  people: ContextEntry[]
  projects: ContextEntry[]
  decisions: ContextEntry[]
  unavailable: string[]
  notes: string[]
}

const ENTITY_QUERY = `{
  projects(where: {status: "open"}, limit: 20) {path name status}
  decisions(where: {pending: true}, limit: 12) {path name summary identified target}
  peopleWithScores {name}
}`

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** A bounded, model-free view of the service's existing notebook index. */
export async function loadVoiceEntities(port: number, fetcher: VoiceEntityFetcher = fetch): Promise<VoiceEntities> {
  const result: VoiceEntities = {
    people: [],
    projects: [],
    decisions: [],
    unavailable: [],
    notes: [
      'Open projects: at most the first 20 service results; additional projects may be omitted.',
      'Pending decisions: at most the first 12 service results; additional decisions may be omitted.',
      'People: at most the top 30 interaction-ranked names; this is not a complete contact list.',
    ],
  }
  const unavailable = (message: string) => {
    if (!result.unavailable.includes(message)) result.unavailable.push(message)
  }
  const query = async (text: string): Promise<Record<string, unknown>> => {
    const response = await fetcher(`http://localhost:${port}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text }),
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) throw new Error('Notebook service request failed')
    const payload: unknown = await response.json()
    if (!record(payload) || !record(payload.data)) throw new Error('Notebook service returned no usable data')
    if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0)) {
      unavailable('The notebook service reported errors; returned context may be incomplete.')
    }
    return payload.data
  }

  let data: Record<string, unknown>
  try {
    data = await query(ENTITY_QUERY)
  } catch {
    unavailable('People, open projects, and pending decisions were unavailable from the notebook service.')
    return result
  }

  for (const [field, limit] of [
    ['projects', 20],
    ['decisions', 12],
  ] as const) {
    const entries = data[field]
    if (!Array.isArray(entries)) {
      unavailable(`${field === 'projects' ? 'Open projects' : 'Pending decisions'} were unavailable.`)
      continue
    }
    for (const entry of entries.slice(0, limit)) {
      if (!record(entry) || !nonempty(entry.path) || !nonempty(entry.name)) {
        unavailable(`Some ${field} could not be loaded.`)
        continue
      }
      if (field === 'projects' && nonempty(entry.status)) {
        result.projects.push({ source: entry.path, body: `${entry.name}\nStatus: ${entry.status}` })
      } else if (
        field === 'decisions' &&
        optionalText(entry.summary) &&
        optionalText(entry.identified) &&
        optionalText(entry.target)
      ) {
        result.decisions.push({
          source: entry.path,
          body: [
            entry.name,
            ...(entry.summary ? [`Summary: ${entry.summary}`] : []),
            ...(entry.identified ? [`Identified: ${entry.identified}`] : []),
            ...(entry.target ? [`Target: ${entry.target}`] : []),
          ].join('\n'),
        })
      } else {
        unavailable(`Some ${field} could not be loaded.`)
      }
    }
  }

  if (!Array.isArray(data.peopleWithScores)) {
    unavailable('Interaction-ranked people were unavailable.')
    return result
  }
  const names: string[] = []
  for (const person of data.peopleWithScores) {
    if (!record(person) || !nonempty(person.name)) {
      unavailable('Some interaction-ranked names could not be loaded.')
    } else if (!names.includes(person.name)) {
      names.push(person.name)
      if (names.length === 30) break
    }
  }
  if (names.length === 0) return result

  const unresolved = (name: string): ContextEntry => ({ source: 'interaction ranking', body: name })
  let profiles: Record<string, unknown>
  try {
    profiles = await query(
      `{${names.map((name, i) => `p${i}: person(name: ${JSON.stringify(name)}) {name names title org path}`).join('\n')}}`,
    )
  } catch {
    result.people = names.map(unresolved)
    unavailable('Ranked people profiles were unavailable; names are from interaction ranking only.')
    return result
  }

  const seenPaths = new Set<string>()
  for (const [i, name] of names.entries()) {
    const profile = profiles[`p${i}`]
    if (profile === null) {
      result.people.push(unresolved(name))
      continue
    }
    if (
      !record(profile) ||
      !nonempty(profile.name) ||
      !nonempty(profile.path) ||
      !Array.isArray(profile.names) ||
      !profile.names.every(nonempty) ||
      !optionalText(profile.title) ||
      !optionalText(profile.org)
    ) {
      result.people.push(unresolved(name))
      unavailable('Some ranked people profiles were unavailable; those names use interaction ranking only.')
      continue
    }
    if (seenPaths.has(profile.path)) continue
    seenPaths.add(profile.path)
    const aliases = profile.names.filter((alias) => alias !== profile.name)
    result.people.push({
      source: profile.path,
      body: [
        profile.name,
        ...(aliases.length ? [`Aliases: ${aliases.join(', ')}`] : []),
        ...(profile.title ? [`Title: ${profile.title}`] : []),
        ...(profile.org ? [`Organization: ${profile.org}`] : []),
      ].join('\n'),
    })
  }
  return result
}
