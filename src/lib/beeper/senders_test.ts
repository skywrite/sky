import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { MacSenderLookup } from '#lib/macMessages/mod.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { notebookSenderNames } from './senders.ts'

test('beeper senders - the notebook names a handle first, then a contact card, which can lead back to a record', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-senders-'))
  try {
    const people = path.join(root, 'people')
    await mkdir(people, { recursive: true })
    await writeFile(
      path.join(people, 'Jane-Doe.md'),
      [
        '---',
        'name: Jane Doe',
        'email: jane@example.com',
        'phone: +1 (555) 010-2277',
        '---',
        '',
        '# Jane Doe',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(people, 'Sam-Lee.md'),
      ['---', 'name: Sam Lee', 'email: sam@example.com', '---', '', '# Sam Lee', ''].join('\n'),
    )
    const store = await PeopleStore.build([people])
    // This Mac's contacts: a card "Jane (AWS)" with her number, a card "Sammy" whose number and address are linked, a stranger's card
    const cards: Record<string, { name: string | null; known: boolean | null; handles: string[] }> = {
      '5550102277': { name: 'Jane (AWS)', known: true, handles: ['5550102277'] },
      '5550103000': { name: 'Sammy', known: true, handles: ['5550103000', 'sam@example.com'] },
      '5550109999': { name: 'Joe’s Cafe', known: false, handles: ['5550109999'] },
      '5550100000': { name: null, known: false, handles: ['5550100000'] },
    }
    const mac: MacSenderLookup = {
      status: {
        supported: true,
        messages: 'readable',
        contacts: 'readable',
        books: 1,
        names: 3,
        handles: 4,
        binary: 'bun',
      },
      resolve: (handle) => cards[handle.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')] ?? null,
    }
    const names = notebookSenderNames(store, mac)
    const bare = notebookSenderNames(null, mac)
    assert({
      given: 'people records with a number and addresses, and contact cards with other names for the same people',
      should:
        'use the record’s name over the card’s, reach a record through the card’s address, fall back to the card, and say nothing for a stranger',
      actual: [
        names.resolve('+1 555-010-2277'),
        names.resolve('555-010-3000'),
        names.resolve('+15550109999'),
        names.resolve('+15550100000'),
        names.resolve('+15550101111'),
        bare.resolve('+15550103000'),
      ],
      expected: [
        { name: 'Jane Doe', known: true, source: 'notebook' },
        { name: 'Sam Lee', known: true, source: 'notebook' },
        { name: 'Joe’s Cafe', known: false, source: 'contacts' },
        { name: null, known: false, source: 'contacts' },
        null,
        { name: 'Sammy', known: true, source: 'contacts' },
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
