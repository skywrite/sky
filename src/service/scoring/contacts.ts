import type { PersonContact } from '#shared/models/Person/contact.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type { Store } from '../store.ts'

/** Scores shift slowly; a minute of staleness is harmless and spares a rebuild per request. */
const REBUILD_MS = 60_000

function rebuilt<T>(build: () => T): () => T {
  let value: T | undefined
  let builtAt = 0
  return () => {
    if (value === undefined || Date.now() - builtAt > REBUILD_MS) {
      value = build()
      builtAt = Date.now()
    }
    return value
  }
}

/** Interaction score by name, for ranking people and resolving a bare first name. */
export function createScoreLookup(store: Store): (name: string) => number {
  const scores = rebuilt(() => {
    const byName = new Map<string, number>()
    for (const person of store.getPeopleWithScores()) {
      const key = normalizeName(person.name)
      byName.set(key, (byName.get(key) ?? 0) + person.score)
    }
    return byName
  })
  return (name) => scores().get(normalizeName(name)) ?? 0
}

/** A person's standing by any of the names their profile lists: their best place among your contacts. */
export function createContactLookup(store: Store): (names: readonly string[]) => PersonContact | null {
  const contacts = rebuilt(() => {
    const byName = new Map<string, PersonContact>()
    let rank = 0
    // Scores come sorted, most active first
    for (const person of store.getPeopleWithScores()) {
      const key = normalizeName(person.name)
      if (byName.has(key)) continue
      byName.set(key, { ...(person.score > 0 ? { rank: ++rank } : {}), lastContact: person.lastContact ?? null })
    }
    return byName
  })
  return (names) => {
    let best: PersonContact | null = null
    for (const name of names) {
      const contact = contacts().get(normalizeName(name))
      if (contact && (!best || (contact.rank ?? Infinity) < (best.rank ?? Infinity))) best = contact
    }
    return best
  }
}
