import { DIR_PEOPLE, DIR_PEOPLE_OLD, PORT_SERVER } from '#config'
import type { GmailAddress } from '#lib/google/mod.ts'
import { type Attendee, createAttendeeNames } from '#service/handler/day/attendeeNames.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'

/** Names a message's people in the order given, one name each (none is ever `self`). */
export type ParticipantNames = (participants: readonly Attendee[]) => string[]

/** Each field a comma-joined list of names; empty when the header was. */
export type MessageParticipants = { from: string; to: string; cc: string; bcc: string }

/**
 * A capture names people the way the day's schedule names meeting attendees.
 * An address on exactly one person profile becomes that person's name, the
 * short one once they are familiar. Any other address keeps the name the mail
 * gave it, or stays an address.
 */
export async function loadParticipantNames(): Promise<ParticipantNames> {
  const [people, familiarity] = await Promise.all([PeopleStore.build([DIR_PEOPLE, DIR_PEOPLE_OLD]), fetchFamiliarity()])
  return createAttendeeNames(people, familiarity)
}

/**
 * A message's from, to, cc and bcc as names. All four are named in one pass,
 * so two people sharing a short name anywhere on the message keep their full
 * names.
 */
export function messageParticipants(
  msg: { from?: GmailAddress; to?: GmailAddress[]; cc?: GmailAddress[]; bcc?: GmailAddress[] },
  names: ParticipantNames,
): MessageParticipants {
  const from = msg.from ? [msg.from] : []
  const to = msg.to ?? []
  const cc = msg.cc ?? []
  const bcc = msg.bcc ?? []
  const named = names([...from, ...to, ...cc, ...bcc].map(attendee))
  const list = (start: number, count: number) =>
    named
      .slice(start, start + count)
      .filter(Boolean)
      .join(', ')
  return {
    from: list(0, from.length) || '(unknown)',
    to: list(from.length, to.length),
    cc: list(from.length + to.length, cc.length),
    bcc: list(from.length + to.length + cc.length, bcc.length),
  }
}

function attendee(address: GmailAddress): Attendee {
  return { email: address.address ?? '', ...(address.name ? { name: normalizeFromName(address.name) } : {}) }
}

/** Convert "Lastname, Firstname" → "Firstname Lastname" */
function normalizeFromName(name: string): string {
  const match = name.match(/^([^,]+),\s*(.+)$/)
  return match ? `${match[2]} ${match[1]}` : name
}

/**
 * Familiarity from the service's interaction scores, which decides who gets a
 * short name. Empty when the service does not answer: everyone keeps a full name.
 */
async function fetchFamiliarity(): Promise<{ name: string; familiarityScore: number }[]> {
  try {
    const response = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ peopleWithScores { name familiarityScore } }' }),
      signal: AbortSignal.timeout(3000),
    })
    const json = (await response.json()) as {
      data?: { peopleWithScores?: { name: string; familiarityScore: number }[] }
    }
    return json.data?.peopleWithScores ?? []
  } catch {
    return []
  }
}
