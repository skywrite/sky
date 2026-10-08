import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { FileGrants } from '#commands/lib/chat/fileGrants.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { SessionBlessings, harvestFileRefs } from './approvals.ts'

const ID = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

const ledgerIn = async () => path.join(await makeTempDir({ prefix: 'sky-blessings-' }), 'file-grants.json')

test('SessionBlessings - a grant and a mention both answer has(); nothing else does', async () => {
  const blessings = new SessionBlessings()
  await blessings.grant('f-created-1', { via: 'created' })
  blessings.blessMention('f-pasted-2')

  assert({
    given: 'one grant with no ledger behind it and one mention',
    should: 'answer has() for both and for nothing else',
    expected: { created: true, pasted: true, other: false },
    actual: {
      created: await blessings.has('f-created-1'),
      pasted: await blessings.has('f-pasted-2'),
      other: await blessings.has('f-unknown'),
    },
  })
})

test('SessionBlessings - a grant goes to the ledger for every chat; a mention stays in the process', async () => {
  const file = await ledgerIn()
  const ledger = new FileGrants(file)
  const first = new SessionBlessings(ledger)
  await first.grant('f1', { via: 'allowed', source: 'ai:chat', at: '2026-10-08 09:00 America/Chicago' })
  first.blessMention('f2')
  const next = new SessionBlessings(new FileGrants(file))

  assert({
    given: 'a grant and a mention from one chat, then another chat on the same ledger',
    should: 'carry the grant with its record and not the mention',
    expected: {
      grant: true,
      mention: false,
      recorded: { at: '2026-10-08 09:00 America/Chicago', via: 'allowed', source: 'ai:chat' },
    },
    actual: { grant: await next.has('f1'), mention: await next.has('f2'), recorded: await ledger.get('f1') },
  })
})

test('SessionBlessings - a grant the ledger refuses still stands for this process', async () => {
  const file = await ledgerIn()
  await writeFile(file, 'nope')
  const blessings = new SessionBlessings(new FileGrants(file))
  const failure = await blessings.grant('f1', { via: 'allowed' }).then(
    () => '',
    (error: Error) => error.message,
  )

  assert({
    given: 'a ledger file that is not JSON',
    should: 'rethrow the refusal after holding the grant in memory',
    expected: { refused: true, held: true },
    actual: { refused: failure.includes('not valid JSON'), held: await blessings.has('f1') },
  })
})

test('harvestFileRefs - lifts ids from Google URLs, prose punctuation and all', () => {
  const text = [
    `Look at https://docs.google.com/document/d/${ID}/edit?tab=t.abc123.`,
    `(also https://drive.google.com/file/d/x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2/view)`,
  ].join('\n')

  assert({
    given: 'a message pasting two Google URLs, one sentence-final, one parenthesized',
    should: 'return both file ids exactly once',
    expected: [ID, 'x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2'],
    actual: harvestFileRefs(text),
  })
})

test('harvestFileRefs - accepts bare id tokens but never id-shaped words', () => {
  assert({
    given: 'a bare file id pasted alone',
    should: 'return it',
    expected: [ID],
    actual: harvestFileRefs(`use ${ID} please`),
  })

  assert({
    given: 'long digit-free words and slashed paths',
    should: 'return nothing',
    expected: [],
    actual: harvestFileRefs('internationalization considerations for docs/architecture-decisions-2026 rollout'),
  })
})
