import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { previousRefOrNone, sameDayCapture } from './fetchUnsavedThreads.ts'

const CUR = new PlainDate(2026, 8, 14)

function collector() {
  const lines: string[] = []
  return { output: { log: (msg: string) => lines.push(msg) }, lines }
}

test('previousRefOrNone computes a ref from a well-formed day path', () => {
  const { output } = collector()

  assert({
    given: 'a previous capture under an MM-DD day dir, in the current month',
    should: 'reference it by day alone',
    expected: '10/actions/messages/email_Jane-Doe_Atlas-kickoff',
    actual: previousRefOrNone('time/2026/08/10-16/08-10/actions/messages/email_Jane-Doe_Atlas-kickoff.md', CUR, output),
  })
})

test('previousRefOrNone recovers a legacy day path', () => {
  const { output, lines } = collector()
  // A day-dir of DD alone: the layout older follow files recorded, pointing
  // at a directory that no longer exists — the date survives via toTimeRef.
  const legacy = 'time/2026/05/25-31/31/actions/messages/email_Jane-Doe_Atlas-kickoff.md'

  assert({
    given: 'a follow carrying a path in the retired DD layout',
    should: 'still link the captures — the ref outlives the layout',
    expected: '05-31/actions/messages/email_Jane-Doe_Atlas-kickoff',
    actual: previousRefOrNone(legacy, CUR, output),
  })
  assert({ given: 'a recovered ref', should: 'warn about nothing', expected: 0, actual: lines.length })
})

test('previousRefOrNone accepts the time refs follows store now', () => {
  const { output } = collector()

  assert({
    given: 'a follow entry stored as a time ref',
    should: 'compute the relative previous ref from it',
    expected: '10/actions/messages/email_Jane-Doe_Atlas-kickoff',
    actual: previousRefOrNone('2026-08-10/actions/messages/email_Jane-Doe_Atlas-kickoff.md', CUR, output),
  })
})

test('previousRefOrNone drops a location it cannot read at all', () => {
  const { output, lines } = collector()
  const damaged = 'actions/messages/email_Jane-Doe_Atlas-kickoff.md'

  assert({
    given: 'a stored location that is neither a ref nor a day path',
    should: 'write without a previous ref rather than throw',
    expected: undefined,
    actual: previousRefOrNone(damaged, CUR, output),
  })
  assert({
    given: 'a dropped ref',
    should: 'say so, naming the value',
    expected: true,
    actual: lines.some((l) => l.includes('unreadable previous path') && l.includes(damaged)),
  })
})

test('sameDayCapture continues the day file an earlier run created', () => {
  const { output, lines } = collector()

  assert({
    given: 'a follow whose last capture is a time ref on the same day as the new message',
    should: 'resolve it to the day file the message appends to',
    expected: {
      date: '2026-08-14',
      path: 'time/2026/08/10-16/08-14/actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md',
    },
    actual: sameDayCapture(
      { date: '2026-08-14', path: '2026-08-14/actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md' },
      '2026-08-14',
      output,
    ),
  })
  assert({ given: 'a continued day file', should: 'warn about nothing', expected: 0, actual: lines.length })
})

test('sameDayCapture starts a new file on a new day or a first capture', () => {
  const { output } = collector()

  assert({
    given: 'a last capture from an earlier day, and no capture at all',
    should: 'continue nothing',
    expected: [undefined, undefined],
    actual: [
      sameDayCapture(
        { date: '2026-08-13', path: '2026-08-13/actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md' },
        '2026-08-14',
        output,
      ),
      sameDayCapture(undefined, '2026-08-14', output),
    ],
  })
})

test('sameDayCapture starts a new file when the stored location cannot be read', () => {
  const { output, lines } = collector()
  const damaged = 'actions/messages/09-30_email_Jane-Doe_Atlas-kickoff.md'

  assert({
    given: 'a same-day entry whose path is neither a ref nor a day path',
    should: 'continue nothing and say why, naming the value',
    expected: [undefined, true],
    actual: [
      sameDayCapture({ date: '2026-08-14', path: damaged }, '2026-08-14', output),
      lines.some((l) => l.includes('unreadable previous path') && l.includes(damaged)),
    ],
  })
})

test('previousRefOrNone stays quiet when there is no previous capture', () => {
  const { output, lines } = collector()

  assert({
    given: 'a thread being captured for the first time',
    should: 'return no ref',
    expected: undefined,
    actual: previousRefOrNone(undefined, CUR, output),
  })
  assert({ given: 'no previous capture', should: 'warn about nothing', expected: 0, actual: lines.length })
})
