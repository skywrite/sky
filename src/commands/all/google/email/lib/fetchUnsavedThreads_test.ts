import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { previousRefOrNone } from './fetchUnsavedThreads.ts'

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

test('previousRefOrNone drops a ref the day-path parser cannot read', () => {
  const { output, lines } = collector()
  // A day-dir of DD alone: the layout older follow files recorded, which no
  // longer exists on disk and which parseDateFromDayPath rejects.
  const legacy = 'time/2026/05/25-31/31/actions/messages/email_Jane-Doe_Atlas-kickoff.md'

  assert({
    given: 'a follow carrying a day path in a layout the parser rejects',
    should: 'write without a previous ref rather than throw',
    expected: undefined,
    actual: previousRefOrNone(legacy, CUR, output),
  })
  assert({
    given: 'a dropped ref',
    should: 'say so, naming the path',
    expected: true,
    actual: lines.some((l) => l.includes('unreadable previous path') && l.includes(legacy)),
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
