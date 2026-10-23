import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { handleKey, recordHandleKeys } from './handles.ts'
import PeopleStore from './mod.ts'

test('people handles - a record’s numbers and addresses become keys, in every shape the fields take', () => {
  assert({
    given: 'phone as a value, a list, and personal/business lines; email as the same; and junk',
    should:
      'key each number by its digits without the North American code, each address lower-cased, and skip the rest',
    actual: [
      recordHandleKeys(undefined, '+1 (555) 010-2277'),
      recordHandleKeys(undefined, ['555-010-2277', '+44 20 7946 0958']),
      recordHandleKeys(
        { personal: 'Jane@Example.com', business: ['j.doe@atlas.example', 'not an address'] },
        {
          personal: ['555 010 2277', '5550102278'],
          business: '+1 555-010-2279',
        },
      ),
      recordHandleKeys('a@b.co, c@d.co', '12345'),
      handleKey(' +1 555 010 2277 '),
      handleKey('Jane@Example.com'),
    ],
    expected: [
      ['5550102277'],
      ['5550102277', '442079460958'],
      ['jane@example.com', 'j.doe@atlas.example', '5550102277', '5550102278', '5550102279'],
      ['a@b.co', 'c@d.co'],
      '5550102277',
      'jane@example.com',
    ],
  })
})

test('people handles - the store finds a person by a number or address their record carries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-people-handles-'))
  try {
    const people = path.join(root, 'people')
    await mkdir(people, { recursive: true })
    await writeFile(
      path.join(people, 'Jane-Doe.md'),
      [
        '---',
        'name: Jane Doe',
        'email:',
        '  personal: jane@example.com',
        'phone:',
        '  - +1 (555) 010-2277',
        '  - 555-010-2278',
        '---',
        '',
        '# Jane Doe',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(people, 'Sam-Lee.md'),
      ['---', 'name: Sam Lee', 'phone: 555 010 3000', '---', '', '# Sam Lee', ''].join('\n'),
    )
    const store = await PeopleStore.build([people])
    assert({
      given: 'two records, one with an address and two numbers, one with a single number',
      should: 'find each by any handle however written, and nobody by a stranger’s number',
      actual: [
        store.findByHandle('+15550102277')?.value.names[0],
        store.findByHandle('(555) 010-2278')?.value.names[0],
        store.findByHandle('JANE@example.com')?.value.names[0],
        store.findByHandle('+1 555 010 3000')?.value.names[0],
        store.findByHandle('+15550109999'),
      ],
      expected: ['Jane Doe', 'Jane Doe', 'Jane Doe', 'Sam Lee', undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
