import { assert, test } from '#test'
import { parseRoster, RUNS_KEPT, serializeRoster, type Roster } from './roster.ts'

test('a roster round-trips through YAML with its cursors as text', () => {
  const roster: Roster = {
    channels: [
      {
        id: 'C0ATLAS0001',
        name: 'atlas',
        cursor: '1700000000.000100',
        pulledAt: '2026-10-19 09:14',
        deepPulledAt: '2026-10-19 09:14',
      },
      { id: 'C0ATLAS0002', name: 'atlas-design', cursor: undefined, pulledAt: undefined, deepPulledAt: undefined },
    ],
    runs: [
      {
        at: '2026-10-19 09:14',
        added: 3,
        channels: 2,
        threads: 1,
        read: 2,
        unchanged: 5,
        muted: 1,
        errors: 0,
        seconds: 21,
      },
    ],
  }
  const serialized = serializeRoster(roster)
  assert({
    given: 'a roster whose cursor looks like a number',
    should: 'read back the same cursor, digits intact',
    actual: parseRoster(serialized),
    expected: roster,
  })
  assert({
    given: 'the serialized roster',
    should: 'quote the cursor so YAML keeps it text',
    actual: serialized.includes("'1700000000.000100'") || serialized.includes('"1700000000.000100"'),
    expected: true,
  })
})

test('a missing or malformed roster is empty, and entries without an id are dropped', () => {
  assert({
    given: 'no file',
    should: 'start empty',
    actual: parseRoster(undefined),
    expected: { channels: [], runs: [] },
  })
  assert({
    given: 'a file without the channels list',
    should: 'start empty',
    actual: parseRoster('channels: nope\n'),
    expected: { channels: [], runs: [] },
  })
  assert({
    given: 'an entry without an id and one whose cursor was saved as a number',
    should: 'drop the first and keep the second without the damaged cursor',
    actual: parseRoster('channels:\n  - name: no-id\n  - id: C0ATLAS0001\n    cursor: 1700000000.0001\n'),
    expected: {
      channels: [
        { id: 'C0ATLAS0001', name: 'C0ATLAS0001', cursor: undefined, pulledAt: undefined, deepPulledAt: undefined },
      ],
      runs: [],
    },
  })
})

test('runs read back with their counts whole, a run without a moment is dropped, and only the last few are kept', () => {
  const many = Array.from(
    { length: RUNS_KEPT + 3 },
    (_, i) => `  - at: '2026-10-19 09:${String(i).padStart(2, '0')}'\n    added: ${i}\n`,
  ).join('')
  assert({
    given: 'a run with a moment and partial counts, one without a moment, and a run with a negative count',
    should: 'keep the first with zeros for what is missing, drop the second, and floor the third at zero',
    actual: parseRoster(
      "channels: []\nruns:\n  - at: '2026-10-19 09:14'\n    added: 3\n    read: 2.7\n  - added: 9\n  - at: '2026-10-19 09:09'\n    added: -4\n",
    ).runs,
    expected: [
      {
        at: '2026-10-19 09:14',
        added: 3,
        channels: 0,
        threads: 0,
        read: 2,
        unchanged: 0,
        muted: 0,
        errors: 0,
        seconds: 0,
      },
      {
        at: '2026-10-19 09:09',
        added: 0,
        channels: 0,
        threads: 0,
        read: 0,
        unchanged: 0,
        muted: 0,
        errors: 0,
        seconds: 0,
      },
    ],
  })
  assert({
    given: 'more runs than the roster keeps',
    should: 'read back only the first few, in file order',
    actual: parseRoster(`channels: []\nruns:\n${many}`).runs.map((run) => run.added),
    expected: Array.from({ length: RUNS_KEPT }, (_, i) => i),
  })
})
