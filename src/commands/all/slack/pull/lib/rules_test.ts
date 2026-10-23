import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { parseRules, readRules, serializeRules, withMuted, writeRules } from './rules.ts'

test('rules read muted channel ids, dropping repeats and anything that is not an id', () => {
  assert({
    given: 'no file, a file with the wrong shape, and a list with a repeat and a number',
    should: 'read as nothing muted, nothing muted, and the two ids once',
    actual: [
      parseRules(undefined),
      parseRules('muted: C0ATLAS0001\n'),
      parseRules('muted:\n  - C0ATLAS0001\n  - 42\n  - C0ATLAS0002\n  - C0ATLAS0001\n'),
    ],
    expected: [{ muted: [] }, { muted: [] }, { muted: ['C0ATLAS0001', 'C0ATLAS0002'] }],
  })
})

test('muting and unmuting a channel keeps the list clean, and the file round-trips', async () => {
  const muted = withMuted(withMuted({ muted: ['C0ATLAS0002'] }, 'C0ATLAS0001', true), 'C0ATLAS0001', true)
  assert({
    given: 'a channel muted twice',
    should: 'be listed once, after the others',
    actual: muted,
    expected: { muted: ['C0ATLAS0002', 'C0ATLAS0001'] },
  })
  assert({
    given: 'the channel unmuted, and a channel that was never muted unmuted',
    should: 'leave the others as they were',
    actual: [withMuted(muted, 'C0ATLAS0001', false), withMuted(muted, 'C0NOPE', false)],
    expected: [{ muted: ['C0ATLAS0002'] }, muted],
  })
  const file = path.join(await makeTempDir({ prefix: 'sky-slack-rules-' }), 'rules.yaml')
  await writeRules(file, muted)
  assert({
    given: 'the rules written and read back',
    should: 'come back sorted',
    actual: [await readRules(file), serializeRules(muted)],
    expected: [{ muted: ['C0ATLAS0001', 'C0ATLAS0002'] }, 'muted:\n  - C0ATLAS0001\n  - C0ATLAS0002'],
  })
  assert({
    given: 'no rules file yet',
    should: 'read as nothing muted',
    actual: await readRules(path.join(path.dirname(file), 'none.yaml')),
    expected: { muted: [] },
  })
})
