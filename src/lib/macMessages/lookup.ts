/**
 * Messages on this Mac: who is texting, by name, and whether the phone files
 * them as known — read from the Mac's own Contacts and Messages databases,
 * for a chat source that shows a number and nothing else. Read-only: nothing
 * is written, and no message text is read. See docs/README.md.
 */

import { Database } from 'bun:sqlite'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { exists } from '#shared/fs/mod.ts'
import { handleKey } from '#shared/models/Store/PeopleStore/handles.ts'

/** What this Mac knows about one handle: a phone number or an email address. */
export type MacSender = {
  /** The contact's name, or null when Contacts has no card with this handle */
  name: string | null
  /**
   * Messages' own filing: true for a sender it treats as known, false for one
   * filed under unknown senders, null when it has no one-to-one chat with the handle
   */
  known: boolean | null
  /** Every number and address the contact cards tie to this handle, the handle itself included */
  handles: string[]
}

/** Whether one database could be read. */
export type SourceState = 'readable' | 'denied' | 'missing' | 'unexpected'

/** Whether the two databases can be read, and what they gave. */
export type MacMessagesStatus = {
  /** This is a Mac; elsewhere there is nothing to read */
  supported: boolean
  messages: SourceState
  /** The Contacts databases as one: readable when any of them is */
  contacts: SourceState
  /** Contacts databases read: the local book and one per account (iCloud, Google…) */
  books: number
  /** Handles with a name */
  names: number
  /** One-to-one chats Messages has filed, known or not */
  handles: number
  /** The program that needs Full Disk Access to read them: this process's own binary */
  binary: string
}

export type MacSenderLookup = {
  resolve(handle: string): MacSender | null
  status: MacMessagesStatus
}

export type MacMessagesPaths = {
  /** Messages' database, chat.db */
  messages: string
  /** Every Contacts database to read */
  contacts: string[]
}

/**
 * One key per handle, whichever way it is written: an address lower-cased; a
 * number as its digits, with the North American country code dropped because
 * Contacts often leaves it out where Messages writes it.
 */
export { handleKey }

/** Where macOS keeps the two databases for this user. */
export async function macMessagesPaths(home = homedir()): Promise<MacMessagesPaths> {
  const book = path.join(home, 'Library', 'Application Support', 'AddressBook')
  const contacts = [path.join(book, 'AddressBook-v22.abcddb')]
  const sources = path.join(book, 'Sources')
  try {
    for (const entry of await readdir(sources)) contacts.push(path.join(sources, entry, 'AddressBook-v22.abcddb'))
  } catch {
    // No per-account sources to list, or none this process may see: the local book alone
  }
  return { messages: path.join(home, 'Library', 'Messages', 'chat.db'), contacts }
}

type NameRow = { card: number; first: string | null; last: string | null; org: string | null; handle: string | null }
type ChatRow = { handle: string | null; filtered: number | null }

const CONTACT_QUERIES = [
  'select r.Z_PK as card, r.ZFIRSTNAME as first, r.ZLASTNAME as last, r.ZORGANIZATION as org, p.ZFULLNUMBER as handle from ZABCDPHONENUMBER p join ZABCDRECORD r on r.Z_PK = p.ZOWNER',
  'select r.Z_PK as card, r.ZFIRSTNAME as first, r.ZLASTNAME as last, r.ZORGANIZATION as org, e.ZADDRESS as handle from ZABCDEMAILADDRESS e join ZABCDRECORD r on r.Z_PK = e.ZOWNER',
]

/** One contact card: its name parts, the handles it carries, and how big its database is. */
type Card = { first: string; last: string; org: string; keys: Set<string>; weight: number }

/**
 * How well a card names a person: a first and a last name, then an
 * organization, then a first name alone — a "Mom" or a "Nana" card, which
 * must not name a file when a fuller card for the same person exists.
 */
function nameRank(card: Card): number {
  if (card.first && card.last) return 3
  if (card.org) return 2
  if (card.first || card.last) return 1
  return 0
}

function cardName(card: Card): string {
  return [card.first, card.last].filter(Boolean).join(' ') || card.org
}

/**
 * The name for every handle, with the cards of all the databases joined into
 * people: two cards that share a number or an address are one person, and
 * the person's name comes from the card that names them best, the one from
 * the largest database when several do. The databases are read in no
 * meaningful order, and a side copy may carry a bare nickname for a number
 * that the main one keeps under a full name.
 */
function namesOf(books: NameRow[][]): Map<string, { name: string; handles: string[] }> {
  const cards: Card[] = []
  for (const rows of books) {
    const byCard = new Map<number, Card>()
    for (const row of rows) {
      const key = row.handle ? handleKey(row.handle) : ''
      if (!key) continue
      let card = byCard.get(row.card)
      if (!card) {
        card = {
          first: row.first?.trim() ?? '',
          last: row.last?.trim() ?? '',
          org: row.org?.trim() ?? '',
          keys: new Set(),
          weight: 0,
        }
        byCard.set(row.card, card)
      }
      card.keys.add(key)
    }
    for (const card of byCard.values()) card.weight = byCard.size
    cards.push(...byCard.values())
  }
  // Union-find over cards that share a handle
  const parent = cards.map((_, index) => index)
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
  const owner = new Map<string, number>()
  cards.forEach((card, index) => {
    for (const key of card.keys) {
      const other = owner.get(key)
      if (other === undefined) owner.set(key, index)
      else parent[find(index)] = find(other)
    }
  })
  const best = new Map<number, Card>()
  cards.forEach((card, index) => {
    const root = find(index)
    const current = best.get(root)
    if (
      !current ||
      nameRank(card) > nameRank(current) ||
      (nameRank(card) === nameRank(current) && card.weight > current.weight)
    ) {
      best.set(root, card)
    }
  })
  const handlesOf = new Map<number, Set<string>>()
  cards.forEach((card, index) => {
    const root = find(index)
    const keys = handlesOf.get(root) ?? new Set<string>()
    for (const key of card.keys) keys.add(key)
    handlesOf.set(root, keys)
  })
  const names = new Map<string, { name: string; handles: string[] }>()
  cards.forEach((card, index) => {
    const root = find(index)
    const name = cardName(best.get(root)!)
    if (name) for (const key of card.keys) names.set(key, { name, handles: [...handlesOf.get(root)!] })
  })
  return names
}
/** Style 45 is a one-to-one chat; 43 a group. `is_filtered` is Messages' unknown-senders filing. */
const CHAT_QUERY = 'select chat_identifier as handle, is_filtered as filtered from chat where style = 45'

/** The rows one database gives, or why it gave none. */
async function rowsOf<T>(file: string, queries: string[]): Promise<{ rows: T[]; state: SourceState }> {
  if (!(await exists(file))) return { rows: [], state: 'missing' }
  let db: Database
  try {
    db = new Database(file, { readonly: true })
  } catch {
    // The file is there and this process may not open it: Full Disk Access is missing
    return { rows: [], state: 'denied' }
  }
  try {
    const rows: T[] = []
    for (const query of queries) rows.push(...(db.query(query).all() as T[]))
    return { rows, state: 'readable' }
  } catch {
    // Open, but not in the shape Sky knows: macOS changed its tables
    return { rows: [], state: 'unexpected' }
  } finally {
    db.close()
  }
}

/** The books as one state: readable when any is, else the most telling failure. */
function contactsState(states: SourceState[]): SourceState {
  for (const state of ['readable', 'denied', 'unexpected'] as const) if (states.includes(state)) return state
  return 'missing'
}

/** Read both databases once; the lookup is null when neither could be read. */
export async function readMacSenders(
  paths: MacMessagesPaths,
): Promise<{ lookup: MacSenderLookup | null; status: MacMessagesStatus }> {
  const bookStates: SourceState[] = []
  const books: NameRow[][] = []
  for (const file of paths.contacts) {
    const book = await rowsOf<NameRow>(file, CONTACT_QUERIES)
    bookStates.push(book.state)
    books.push(book.rows)
  }
  const names = namesOf(books)
  const chats = await rowsOf<ChatRow>(paths.messages, [CHAT_QUERY])
  const known = new Map<string, boolean>()
  for (const row of chats.rows) {
    const key = row.handle ? handleKey(row.handle) : ''
    if (!key) continue
    // A number may have an SMS chat and an iMessage chat: known when either is
    known.set(key, (known.get(key) ?? false) || !row.filtered)
  }
  const status: MacMessagesStatus = {
    supported: true,
    messages: chats.state,
    contacts: contactsState(bookStates),
    books: bookStates.filter((state) => state === 'readable').length,
    names: names.size,
    handles: known.size,
    binary: process.execPath,
  }
  if (status.messages !== 'readable' && status.contacts !== 'readable') return { lookup: null, status }
  return {
    status,
    lookup: {
      status,
      resolve(handle) {
        const key = handleKey(handle)
        if (!key) return null
        const named = names.get(key) ?? null
        const verdict = known.get(key)
        if (named === null && verdict === undefined) return null
        return { name: named?.name ?? null, known: verdict ?? null, handles: named?.handles ?? [key] }
      },
    },
  }
}

const UNSUPPORTED = (): MacMessagesStatus => ({
  supported: false,
  messages: 'missing',
  contacts: 'missing',
  books: 0,
  names: 0,
  handles: 0,
  binary: process.execPath,
})

/** The lookup over this Mac's databases; null off a Mac or when neither can be read. */
export async function openMacSenderLookup(paths?: MacMessagesPaths): Promise<MacSenderLookup | null> {
  if (!paths && process.platform !== 'darwin') return null
  return (await readMacSenders(paths ?? (await macMessagesPaths()))).lookup
}

/** Whether this Mac's databases can be read, for the Connections page. */
export async function macMessagesStatus(paths?: MacMessagesPaths): Promise<MacMessagesStatus> {
  if (!paths && process.platform !== 'darwin') return UNSUPPORTED()
  return (await readMacSenders(paths ?? (await macMessagesPaths()))).status
}
