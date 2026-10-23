import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { LAND_RUNS_KEPT, parseLandState, readLandState, serializeLandState, writeLandState } from './state.ts'

test('the landing state round-trips with its cursors as text and keeps the last few runs', async () => {
  const run = { at: '2026-10-20 09:14', threads: 2, conversations: 1, docs: 3, known: 4, errors: 0, seconds: 12 }
  const state = { feedCursor: '1760000000.000100', ownCursor: '1760000050.000000', runs: [run] }
  const serialized = serializeLandState(state)
  assert({
    given: 'a state with number-like cursors',
    should: 'read back the same, cursors quoted in the file',
    actual: [parseLandState(serialized), /['"]1760000000\.000100['"]/.test(serialized)],
    expected: [state, true],
  })
  assert({
    given: 'no file, a file without runs, and a run without a moment',
    should: 'start empty, keep cursors, drop the run',
    actual: [
      parseLandState(undefined),
      parseLandState("feedCursor: '1'\n"),
      parseLandState('runs:\n  - docs: 3\n  - at: 2026-10-20 09:14\n    docs: 2\n'),
    ],
    expected: [
      { runs: [] },
      { feedCursor: '1', runs: [] },
      { runs: [{ at: '2026-10-20 09:14', threads: 0, conversations: 0, docs: 2, known: 0, errors: 0, seconds: 0 }] },
    ],
  })
  const many = { runs: Array.from({ length: LAND_RUNS_KEPT + 2 }, (_, i) => ({ ...run, docs: i })) }
  assert({
    given: 'more runs than kept',
    should: 'keep the first few',
    actual: parseLandState(serializeLandState(many)).runs.map((entry) => entry.docs),
    expected: Array.from({ length: LAND_RUNS_KEPT }, (_, i) => i),
  })
  const file = path.join(await makeTempDir({ prefix: 'sky-slack-land-' }), 'land.yaml')
  await writeLandState(file, state)
  assert({ given: 'the file written', should: 'read back', actual: await readLandState(file), expected: state })
})
