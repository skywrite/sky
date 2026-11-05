/**
 * How much you're in touch with a person, as a model reads it: one line the
 * notebook service puts at the top of a profile it hands to chat, from Sky's
 * interaction scores. Written and read here only, so the two never drift.
 */

/** Where a person stands among your contacts. */
export interface PersonContact {
  /** Their place by interaction score: 1 is your most active contact. Absent when no contact is logged. */
  rank?: number
  /** The latest direct contact, YYYY-MM-DD; a mention never moves it. */
  lastContact: string | null
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st */
function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10]
  return `${n}${suffix ?? 'th'}`
}

/** `> Contact: your 12th most active contact · last in touch 2026-10-28` */
export function contactLine(contact: PersonContact | null): string {
  if (!contact?.rank) return '> Contact: no contact logged'
  const last = contact.lastContact ? ` · last in touch ${contact.lastContact.slice(0, 10)}` : ''
  return `> Contact: your ${ordinal(contact.rank)} most active contact${last}`
}

const RANK = /^> Contact: your (\d+)(?:st|nd|rd|th) most active contact/m

/** The place a profile's contact line gives; undefined when it has none or no contact is logged. */
export function contactRank(markdown: string): number | undefined {
  const match = RANK.exec(markdown)
  return match ? Number(match[1]) : undefined
}
