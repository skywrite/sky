import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type { PersonScore } from '../../scoring/mod.ts'
import { matchScore } from '../vocabulary/mod.ts'
import type { MeetingInvitee, MeetingPerson } from './types.ts'

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
  interactionScores: readonly Pick<PersonScore, 'name' | 'score'>[],
): MeetingPerson[] {
  if (!store || !query.trim()) return []
  // Store.getPeopleWithScores already combines interactions across a profile's aliases.
  const scoresByName = new Map(interactionScores.map((person) => [normalizeName(person.name), person.score]))
  const matches: Array<MeetingPerson & { match: number; score: number }> = []
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
    .map(({ score: _, match: __, ...person }) => person)
}

export function resolveInvitee(query: string, candidates: MeetingPerson[]): MeetingInvitee {
  if (EMAIL.test(query)) {
    const email = query.toLowerCase()
    const match = candidates.find((person) => person.emails.includes(email))
    return { query, candidates, selected: { name: match?.name ?? email, email } }
  }
  const exact = candidates.filter((person) => person.name.toLowerCase() === query.toLowerCase())
  // A unique full name or a single candidate is reviewable. Namesakes and multiple addresses stay a choice.
  const person = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : undefined
  return {
    query,
    candidates,
    selected: person?.emails.length === 1 ? { name: person.name, email: person.emails[0]! } : null,
  }
}
