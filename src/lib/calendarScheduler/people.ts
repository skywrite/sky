import type { CalendarInvitee, CalendarContact } from '#lib/calendarScheduler/types.ts'
import { matchScore } from '#lib/string/matchScore.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** Read only explicit contact fields. A name never supplies a guessed email address. */
export function contactEmails(raw: unknown): string[] {
  const collect = (value: unknown): string[] => {
    if (typeof value === 'string') return value.split(/[;,\s]+/).filter((email) => EMAIL.test(email))
    if (Array.isArray(value)) return value.flatMap(collect)
    if (value && typeof value === 'object') return Object.values(value).flatMap(collect)
    return []
  }
  return [...new Set(collect(raw).map((email) => email.toLowerCase()))]
}

export function meetingPeople(
  store: MarkdownStore | null,
  query: string,
  interactionScores: readonly { name: string; score: number }[],
): CalendarContact[] {
  if (!store || !query.trim()) return []
  // Store.getPeopleWithScores already combines interactions across a profile's aliases.
  const scoresByName = new Map(interactionScores.map((person) => [normalizeName(person.name), person.score]))
  const matches: Array<CalendarContact & { match: number; score: number }> = []
  for (const { doc, path } of store.people.getAll()) {
    const names = [...doc.names, ...(doc.alt ? [doc.alt] : [])]
    const emails = contactEmails(doc.yaml['email'])
    const matchesQuery = [...names, ...emails]
      .map((value) => matchScore(query, value))
      .filter((score): score is number => score !== null)
    if (!matchesQuery.length) continue
    matches.push({
      id: path,
      name: names[0] ?? emails[0] ?? query,
      aliases: names.slice(1),
      emails,
      hint: [doc.yaml['title'], doc.yaml['org']]
        .filter((value): value is string => typeof value === 'string')
        .join(' · '),
      match: Math.min(...matchesQuery),
      // The canonical entry already includes its unique aliases; shared names belong to neither namesake.
      score: scoresByName.get(normalizeName(names[0] ?? '')) ?? 0,
    })
  }
  return matches
    .sort((a, b) => a.match - b.match || b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(({ score, match: _, ...person }) => ({ ...person, interactionScore: score }))
}

export function resolveInvitee(query: string, candidates: CalendarContact[]): CalendarInvitee {
  if (EMAIL.test(query)) {
    const email = query.toLowerCase()
    const match = candidates.find((person) => person.emails.includes(email))
    return { query, candidates, selected: { name: match?.name ?? email, email } }
  }
  const direct = candidates
    .map((person) => ({
      person,
      match: Math.min(...[person.name, ...(person.aliases ?? [])].map((name) => matchScore(query, name) ?? Infinity)),
    }))
    .filter(({ match }) => match <= 2)
  const best = Math.min(...direct.map(({ match }) => match))
  const strongest = direct.filter(({ match }) => match === best)
  // A unique stored name, alias or direct prefix outranks fuzzy/domain matches.
  // Interaction scores order ties; they never authorize choosing between namesakes or emails.
  const person = strongest.length === 1 ? strongest[0]!.person : candidates.length === 1 ? candidates[0] : undefined
  return {
    query,
    candidates,
    ...(person ? { personId: person.id } : {}),
    selected: person?.emails.length === 1 ? { name: person.name, email: person.emails[0]! } : null,
  }
}

/** Ask only for the unresolved part, using addresses the lookup already found. */
export function inviteeQuestion(invitee: CalendarInvitee): string {
  const person = invitee.candidates.find((candidate) => candidate.id === invitee.personId)
  if (person) {
    return person.emails.length
      ? `Which email address for ${person.name}: ${person.emails.join(' or ')}?`
      : `No saved email address for ${person.name}. Which address should be used?`
  }
  return invitee.candidates.length
    ? `Which contact do you mean by "${invitee.query}"?`
    : `No saved contact matches "${invitee.query}". What name or email address should be used?`
}
