import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import computePreviousRef from './computePreviousRef.ts'

test('computePreviousRef - same month returns DD/subpath', () => {
  const FIXTURES = [
    {
      prev: 'time/2026/03/16-22/21/actions/messages/email_Foo_Bar.md',
      cur: '2026-03-23',
      expected: '21/actions/messages/email_Foo_Bar',
    },
    {
      prev: 'time/2026/03/16-22/16/comm/email/From-Name_Subject.md',
      cur: '2026-03-18',
      expected: '16/comm/email/From-Name_Subject',
    },
  ]

  for (const { prev, cur, expected } of FIXTURES) {
    assert({
      given: `prev=${prev}, cur=${cur}`,
      should: 'return DD/subpath',
      actual: computePreviousRef(prev, PlainDate.fromString(cur)),
      expected,
    })
  }
})

test('computePreviousRef - different month same year returns MM-DD/subpath', () => {
  const FIXTURES = [
    {
      prev: 'time/2026/02/23-01/28/actions/messages/slack_Channel_Thread.md',
      cur: '2026-03-05',
      expected: '02-28/actions/messages/slack_Channel_Thread',
    },
    {
      prev: 'time/2026/01/01-01/01/comm/email/Alice_Hello.md',
      cur: '2026-06-15',
      expected: '01-01/comm/email/Alice_Hello',
    },
  ]

  for (const { prev, cur, expected } of FIXTURES) {
    assert({
      given: `prev=${prev}, cur=${cur}`,
      should: 'return MM-DD/subpath',
      actual: computePreviousRef(prev, PlainDate.fromString(cur)),
      expected,
    })
  }
})

test('computePreviousRef - different year returns YYYY-MM-DD/subpath', () => {
  const prev = 'time/2025/12/29-04/31/actions/messages/email_Bob_Recap.md'
  const cur = '2026-01-05'

  assert({
    given: 'previous from 2025, current in 2026',
    should: 'return YYYY-MM-DD/subpath',
    actual: computePreviousRef(prev, PlainDate.fromString(cur)),
    expected: '2025-12-31/actions/messages/email_Bob_Recap',
  })
})

test('computePreviousRef - cross-month week spillover (xDD day)', () => {
  // March 28-03 week, x02 = April 2nd
  const prev = 'time/2026/03/30-05/x02/comm/email/Carlos_Update.md'
  const cur = '2026-04-05'

  assert({
    given: 'previous from cross-month xDD day, current same month as resolved date',
    should: 'return DD/subpath (April to April)',
    actual: computePreviousRef(prev, PlainDate.fromString(cur)),
    expected: '02/comm/email/Carlos_Update',
  })
})

test('computePreviousRef - strips .md extension', () => {
  const prev = 'time/2026/03/16-22/20/notes/meeting.md'
  const cur = '2026-03-22'

  assert({
    given: 'a path ending in .md',
    should: 'strip the extension from subpath',
    actual: computePreviousRef(prev, PlainDate.fromString(cur)),
    expected: '20/notes/meeting',
  })
})

test('computePreviousRef - nested subpaths preserved', () => {
  const prev = 'time/2026/03/16-22/18/actions/messages/email_From-Name_Subject-Line.md'
  const cur = '2026-03-20'

  assert({
    given: 'a deeply nested subpath',
    should: 'preserve the full subpath after DD/',
    actual: computePreviousRef(prev, PlainDate.fromString(cur)),
    expected: '18/actions/messages/email_From-Name_Subject-Line',
  })
})
