import { Database } from 'bun:sqlite'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { handleKey, readMacSenders } from './lookup.ts'

/** A Contacts database with the three tables the lookup reads, in the shape macOS writes them. */
function book(
  file: string,
  people: { first?: string; last?: string; org?: string; phones?: string[]; emails?: string[] }[],
) {
  const db = new Database(file)
  db.run('create table ZABCDRECORD (Z_PK integer primary key, ZFIRSTNAME text, ZLASTNAME text, ZORGANIZATION text)')
  db.run('create table ZABCDPHONENUMBER (Z_PK integer primary key, ZOWNER integer, ZFULLNUMBER text)')
  db.run('create table ZABCDEMAILADDRESS (Z_PK integer primary key, ZOWNER integer, ZADDRESS text)')
  people.forEach((person, index) => {
    const pk = index + 1
    db.run('insert into ZABCDRECORD values (?, ?, ?, ?)', [
      pk,
      person.first ?? null,
      person.last ?? null,
      person.org ?? null,
    ])
    for (const phone of person.phones ?? [])
      db.run('insert into ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) values (?, ?)', [pk, phone])
    for (const email of person.emails ?? [])
      db.run('insert into ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) values (?, ?)', [pk, email])
  })
  db.close()
}

/** Messages' chat table: style 45 one-to-one, 43 a group; is_filtered is the unknown-senders filing. */
function chats(file: string, rows: { handle: string; style?: number; filtered?: number }[]) {
  const db = new Database(file)
  db.run('create table chat (ROWID integer primary key, chat_identifier text, style integer, is_filtered integer)')
  for (const row of rows)
    db.run('insert into chat (chat_identifier, style, is_filtered) values (?, ?, ?)', [
      row.handle,
      row.style ?? 45,
      row.filtered ?? 0,
    ])
  db.close()
}

test('mac messages - a handle resolves to the contact’s name and the phone’s own verdict, however it is written', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mac-messages-'))
  try {
    const local = path.join(root, 'AddressBook-v22.abcddb')
    const cloud = path.join(root, 'Sources', 'one', 'AddressBook-v22.abcddb')
    await mkdir(path.dirname(cloud), { recursive: true })
    book(local, [{ first: 'Maya', last: 'Okafor', phones: ['+1 (555) 010-2277'] }])
    book(cloud, [
      { org: 'Joe’s Cafe', phones: ['555-010-3000'] },
      { first: 'Jane', last: 'Doe', emails: ['Jane@Example.com'], phones: ['+44 20 7946 0958'] },
      { first: 'Maya', last: 'Okafor-Second', phones: ['+1 (555) 010-2277'] },
    ])
    const messages = path.join(root, 'chat.db')
    chats(messages, [
      { handle: '+15550102277', filtered: 0 },
      { handle: '+15550102277', filtered: 1 },
      { handle: '+15550109999', filtered: 1 },
      { handle: '+15550103000', filtered: 2 },
      { handle: 'jane@example.com', filtered: 0 },
      { handle: 'chat123', style: 43, filtered: 0 },
    ])
    const { lookup, status } = await readMacSenders({
      messages,
      contacts: [local, cloud, path.join(root, 'none.abcddb')],
    })
    const pick = (found: { name: string | null; known: boolean | null } | null | undefined) =>
      found ? { name: found.name, known: found.known } : found
    assert({
      given:
        'two Contacts books, a Messages database with known, filtered and group chats, and a book that is not there',
      should:
        'name a handle however it is written, let the largest database name a person two full cards share, say what the phone decided, and count what was read',
      actual: [
        pick(lookup?.resolve('+1 555-010-2277')),
        pick(lookup?.resolve('5550109999')),
        pick(lookup?.resolve('+15550103000')),
        pick(lookup?.resolve('JANE@example.com')),
        pick(lookup?.resolve('+442079460958')),
        pick(lookup?.resolve('+1 555 010 0000')),
        pick(lookup?.resolve('  ')),
        { ...status, binary: typeof status.binary },
      ],
      expected: [
        { name: 'Maya Okafor-Second', known: true },
        { name: null, known: false },
        { name: 'Joe’s Cafe', known: false },
        { name: 'Jane Doe', known: true },
        { name: 'Jane Doe', known: null },
        null,
        null,
        {
          supported: true,
          messages: 'readable',
          contacts: 'readable',
          books: 2,
          names: 4,
          handles: 4,
          binary: 'string',
        },
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mac messages - a database this process may not open reads as denied, a missing one as missing, a strange one as unexpected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mac-messages-'))
  try {
    const sealed = path.join(root, 'chat.db')
    chats(sealed, [{ handle: '+15550102277' }])
    await chmod(sealed, 0o000)
    const local = path.join(root, 'AddressBook-v22.abcddb')
    book(local, [{ first: 'Maya', last: 'Okafor', phones: ['+15550102277'] }])
    const strange = path.join(root, 'strange.db')
    new Database(strange).close()
    const half = await readMacSenders({ messages: sealed, contacts: [local] })
    const none = await readMacSenders({ messages: sealed, contacts: [path.join(root, 'none.abcddb')] })
    const odd = await readMacSenders({ messages: strange, contacts: [strange] })
    assert({
      given: 'a Messages database with no read permission, a readable book, a missing book, and an empty database',
      should: 'still name from the book alone, give no lookup when nothing can be read, and say which failure it was',
      actual: [
        [half.status.messages, half.status.contacts, half.lookup?.resolve('+1 555 010 2277')],
        [none.status.messages, none.status.contacts, none.lookup],
        [odd.status.messages, odd.status.contacts, odd.lookup],
      ],
      expected: [
        ['denied', 'readable', { name: 'Maya Okafor', known: null, handles: ['5550102277'] }],
        ['denied', 'missing', null],
        ['unexpected', 'unexpected', null],
      ],
    })
  } finally {
    await chmod(path.join(root, 'chat.db'), 0o600).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('mac messages - handle keys', () => {
  assert({
    given: 'numbers and addresses the way Contacts, Messages and Beeper write them',
    should: 'come to one key each',
    actual: ['+1 (555) 010-2277', '15550102277', '555.010.2277', '+44 20 7946 0958', '22395', ' Jane@Example.com '].map(
      handleKey,
    ),
    expected: ['5550102277', '5550102277', '5550102277', '442079460958', '22395', 'jane@example.com'],
  })
})

test('mac messages - cards that share a number or an address are one person, named by the fullest card', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mac-messages-join-'))
  try {
    const side = path.join(root, 'Sources', 'a-side-copy', 'AddressBook-v22.abcddb')
    const main = path.join(root, 'Sources', 'b-main', 'AddressBook-v22.abcddb')
    await mkdir(path.dirname(side), { recursive: true })
    await mkdir(path.dirname(main), { recursive: true })
    // A side copy read first, with a bare nickname for the number
    book(side, [{ first: 'Mom', phones: ['+1 (555) 010-7110'] }])
    // The main database: the number under another nickname with the person's address, the full name with the address alone
    book(main, [
      { first: 'Nana', phones: ['555-010-7110'], emails: ['jane@example.com'] },
      { first: 'Jane', last: 'Doe', emails: ['Jane@Example.com'] },
      { first: 'Mom', phones: ['+1 (555) 010-5120'] },
      { org: 'Joe’s Cafe', phones: ['555-010-3000'] },
    ])
    const { lookup } = await readMacSenders({
      messages: path.join(root, 'no-chat.db'),
      contacts: [path.join(root, 'none.abcddb'), side, main],
    })
    assert({
      given:
        'a number a side copy calls Mom, the main database calls Nana with an address, and a full-name card with that address',
      should:
        'name the number and the address by the full name, keep the other Mom and the cafe as they are, and count the people',
      actual: [
        lookup?.resolve('+15550107110')?.name,
        lookup?.resolve('jane@example.com')?.name,
        lookup?.resolve('+15550105120')?.name,
        lookup?.resolve('555-010-3000')?.name,
        lookup?.status.names,
        lookup?.resolve('+15550107110')?.handles.sort(),
      ],
      expected: ['Jane Doe', 'Jane Doe', 'Mom', 'Joe’s Cafe', 4, ['5550107110', 'jane@example.com']],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
