import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { FileGrants } from './fileGrants.ts'

const ledgerIn = async () =>
  path.join(await makeTempDir({ prefix: 'sky-file-grants-' }), 'state', 'ai', 'file-grants.json')

test('FileGrants - a go is a grant for the file, in this process and any other', async () => {
  const file = await ledgerIn()
  const here = new FileGrants(file)
  const elsewhere = new FileGrants(file)
  const before = await elsewhere.has('doc-1')
  await here.grant('doc-1', { via: 'allowed', source: '/chat/source/t1', at: '2026-10-08 09:00 America/Chicago' })

  assert({
    given: 'a grant written through one handle after another handle had looked',
    should: 'be seen by both without a restart, and grant nothing else',
    actual: {
      before,
      here: await here.has('doc-1'),
      elsewhere: await elsewhere.has('doc-1'),
      other: await elsewhere.has('doc-2'),
    },
    expected: { before: false, here: true, elsewhere: true, other: false },
  })
})

test('FileGrants - the first grant is the record; later ones only fill its blanks', async () => {
  const file = await ledgerIn()
  const grants = new FileGrants(file)
  await grants.grant('doc-1', { via: 'allowed', source: 'ai:chat', at: '2026-10-08 09:00 America/Chicago' })
  await grants.grant('doc-1', {
    via: 'created',
    source: 'later',
    title: 'Atlas Plan',
    url: 'https://docs.google.com/document/d/doc-1/edit',
    at: '2026-10-08 10:00 America/Chicago',
  })
  await grants.describe('doc-1', { title: 'Atlas Plan v2', kind: 'doc', url: '' })
  await grants.describe('doc-9', { title: 'Never granted' })

  const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, Record<string, unknown>>

  assert({
    given: 'a second grant and a description for one file, and a description of a file never granted',
    should: 'keep the first grant, fill title and url once, add the kind in reading order, and grant nothing new',
    actual: {
      recorded: await grants.get('doc-1'),
      order: Object.keys(written['doc-1']),
      stray: await grants.has('doc-9'),
    },
    expected: {
      recorded: {
        at: '2026-10-08 09:00 America/Chicago',
        via: 'allowed',
        source: 'ai:chat',
        title: 'Atlas Plan',
        kind: 'doc',
        url: 'https://docs.google.com/document/d/doc-1/edit',
      },
      order: ['at', 'via', 'source', 'title', 'kind', 'url'],
      stray: false,
    },
  })
})

test('FileGrants - the file reads newest first, and a key deleted by hand is a revoked grant', async () => {
  const file = await ledgerIn()
  const grants = new FileGrants(file)
  await grants.grant('doc-old', { via: 'created', at: '2026-10-01 11:34 America/Chicago', title: 'Older' })
  await grants.grant('doc-new', { via: 'allowed', at: '2026-10-08 09:00 America/Chicago', title: 'Newer' })
  const text = await readFile(file, 'utf8')
  const parsed = JSON.parse(text) as Record<string, unknown>
  await writeFile(file, JSON.stringify({ 'doc-old': parsed['doc-old'] }, null, 2) + '\n')

  assert({
    given: 'two grants, then the newer key deleted from the file by hand',
    should: 'list newest first as a pretty file, and no longer grant the deleted key',
    actual: {
      order: Object.keys(parsed),
      pretty: text.startsWith(
        '{\n  "doc-new": {\n    "at": "2026-10-08 09:00 America/Chicago",\n    "via": "allowed",',
      ),
      revoked: await grants.has('doc-new'),
      kept: await grants.has('doc-old'),
    },
    expected: { order: ['doc-new', 'doc-old'], pretty: true, revoked: false, kept: true },
  })
})

test('FileGrants - a ledger that is not JSON grants nothing and is never overwritten', async () => {
  const file = await ledgerIn()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, '{ not json')
  const grants = new FileGrants(file)
  const has = await grants.has('doc-1')
  const failure = await grants.grant('doc-1', { via: 'allowed' }).then(
    () => '',
    (error: Error) => error.message,
  )

  assert({
    given: 'a broken ledger file, read and then written to',
    should: 'grant nothing, refuse the write naming the file, and leave the file as it was',
    actual: {
      has,
      failure: failure.includes('not valid JSON') && failure.includes(file),
      text: await readFile(file, 'utf8'),
    },
    expected: { has: false, failure: true, text: '{ not json' },
  })
})
