import type { CalendarEvent } from '#lib/google/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { FAMILIAR_NAME_THRESHOLD } from '../../scoring/familiarity.ts'
import type { PersonScore } from '../../scoring/ScoringStore.ts'
import { contactEmails } from '../meetings/people.ts'

interface AttendeeName {
  full: string
  familiar: string
  shorten: boolean
}

/** Read the current contacts once per schedule; only explicit email matches identify a person. */
export function createAttendeeNames(
  people?: PeopleStore | null,
  scores: readonly PersonScore[] = [],
): (attendees: CalendarEvent['attendees']) => string[] {
  const byName = new Map(scores.map((person) => [normalizeName(person.name), person.familiarityScore ?? 0]))
  const profiles = [...(people?.getAll() ?? [])]
  const owners = new Map<string, Set<string>>()
  for (const { doc, path } of profiles) {
    for (const name of doc.names.filter((name): name is string => typeof name === 'string')) {
      const key = normalizeName(name)
      const files = owners.get(key) ?? new Set<string>()
      files.add(path)
      owners.set(key, files)
    }
  }
  const byEmail = new Map<string, AttendeeName | null>()
  for (const { doc } of profiles) {
    const names = [...doc.names, ...(doc.alt ? [doc.alt] : [])]
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !/[\/@]/.test(name))
    const preferred = names[0]
    // An explicit short alias wins. Preserve compound given names recorded before a longer name.
    const familiar =
      names.find((name) => !/\s/.test(name) || names.some((other) => other.startsWith(`${name} `))) ??
      preferred?.split(/\s+/)[0]
    const full = names.find((name) => name !== familiar && /\s/.test(name)) ?? preferred
    // Scores already combine aliases. Take one total, and never borrow a shared name's score.
    const familiarity = Math.max(
      0,
      ...doc.names
        .filter((name): name is string => typeof name === 'string')
        .map(normalizeName)
        .filter((name) => owners.get(name)?.size === 1)
        .map((name) => byName.get(name) ?? 0),
    )
    const name = full && familiar ? { full, familiar, shorten: familiarity >= FAMILIAR_NAME_THRESHOLD } : null
    for (const email of contactEmails(doc.yaml['email'])) {
      // A shared address identifies no single person, regardless of profile order or interaction score.
      byEmail.set(email, byEmail.has(email) ? null : name)
    }
  }
  return (attendees) => {
    const names = attendees
      .filter((attendee) => !attendee.self)
      .map((attendee): AttendeeName => {
        const known = byEmail.get(attendee.email.trim().toLowerCase())
        if (known) return known
        const fallback = attendee.name?.trim() || attendee.email
        return { full: fallback, familiar: fallback, shorten: false }
      })
    const counts = new Map<string, number>()
    for (const { familiar } of names) {
      const key = familiar.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return names.map(({ full, familiar, shorten }) =>
      !shorten || counts.get(familiar.toLowerCase())! > 1 ? full : familiar,
    )
  }
}
