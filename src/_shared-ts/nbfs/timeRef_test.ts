import { assert, test } from '#test'
import { isTimeRef, resolveTimeRef, toTimeRef } from './timeRef.ts'

const throws = (fn: () => unknown): boolean => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

// --- toTimeRef ---

test('toTimeRef passes a ref through untouched', () => {
  assert({
    given: 'a value already in ref form',
    should: 'return it unchanged — canonicalizing is idempotent',
    expected: '2026-05-31/actions/messages/email_Jane-Doe_Atlas.md',
    actual: toTimeRef('2026-05-31/actions/messages/email_Jane-Doe_Atlas.md'),
  })
})

test('toTimeRef reduces a v1.1 path to its ref', () => {
  assert({
    given: 'a current-layout path with an MM-DD day dir',
    should: 'keep the date and the subpath below the day dir',
    expected: '2026-08-10/actions/messages/email_Jane-Doe_Atlas.md',
    actual: toTimeRef('time/2026/08/10-16/08-10/actions/messages/email_Jane-Doe_Atlas.md'),
  })
})

test('toTimeRef trusts the MM-DD day dir over the path month', () => {
  assert({
    given: 'a cross-month spillover day in the v1.1 layout',
    should: "take the month from the day dir, which carries the day's own",
    expected: '2022-04-02/day.md',
    actual: toTimeRef('time/2022/03/28-03/04-02/day.md'),
  })
})

test('toTimeRef recovers the date from a legacy DD day dir', () => {
  assert({
    given: 'a path in the retired DD layout, pointing at a dir that no longer exists',
    should: 'recover the date from the month segment and day dir',
    expected: '2026-05-31/actions/messages/email_Jane-Doe_Atlas.md',
    actual: toTimeRef('time/2026/05/25-31/31/actions/messages/email_Jane-Doe_Atlas.md'),
  })
})

test('toTimeRef keeps a legacy head-of-week day in the path month', () => {
  assert({
    given: 'a bare DD at the head of a cross-month week (Jun 29 in week 29-05)',
    should: 'stay in the month the path names',
    expected: '2026-06-29/actions/messages/slack_Jane_topic.md',
    actual: toTimeRef('time/2026/06/29-05/29/actions/messages/slack_Jane_topic.md'),
  })
})

test('toTimeRef rolls a legacy tail-of-week day into the next month', () => {
  assert({
    given: 'a bare DD at the tail of a cross-month week (day 01 in week 29-05 of June)',
    should: "date it in July — the week dir's month belongs to its first day",
    expected: '2026-07-01/actions/messages/slack_Jane_topic.md',
    actual: toTimeRef('time/2026/06/29-05/01/actions/messages/slack_Jane_topic.md'),
  })
})

test('toTimeRef rolls an x-marked spillover day into the next month', () => {
  assert({
    given: 'the legacy xDD marker for a cross-month day',
    should: 'strip the marker and date the day in the following month',
    expected: '2026-07-01/actions/messages/slack_Jane_topic.md',
    actual: toTimeRef('time/2026/06/29-05/x01/actions/messages/slack_Jane_topic.md'),
  })
})

test('toTimeRef rolls a December spillover into the next year', () => {
  assert({
    given: 'a legacy cross-month day at the tail of a December week',
    should: 'land in January of the following year',
    expected: '2027-01-01/notes/note_yearend.md',
    actual: toTimeRef('time/2026/12/28-03/01/notes/note_yearend.md'),
  })
})

test('toTimeRef accepts an absolute path', () => {
  assert({
    given: 'a full filesystem path down to the notebook',
    should: 'read the segments after the time dir',
    expected: '2026-08-10/journal/journal_morning.md',
    actual: toTimeRef('/Users/someone/Notebook/time/2026/08/10-16/08-10/journal/journal_morning.md'),
  })
})

test('toTimeRef throws on damage rather than guessing', () => {
  assert({
    given: 'strings that are neither refs nor day paths',
    should: 'throw on each — unreadable state is surfaced, not silently dated',
    expected: [true, true, true, true],
    actual: [
      throws(() => toTimeRef('state/follow/email/active/thread.yaml')),
      throws(() => toTimeRef('time/2026/05/25-31')),
      throws(() => toTimeRef('time/2026/13-01/32/x.md')),
      throws(() => toTimeRef('2026-13-01/x.md')),
    ],
  })
})

// --- resolveTimeRef ---

test('resolveTimeRef places a ref in the current layout', () => {
  assert({
    given: 'a ref',
    should: "return today's real path for that date",
    expected: 'time/2026/05/25-31/05-31/actions/messages/email_Jane-Doe_Atlas.md',
    actual: resolveTimeRef('2026-05-31/actions/messages/email_Jane-Doe_Atlas.md'),
  })
})

test('resolveTimeRef repairs a legacy path to the dir that exists now', () => {
  assert({
    given: 'a stored path in the retired DD layout',
    should: 'resolve to the MM-DD dir the notebook actually uses — the recorded dir never has to exist',
    expected: 'time/2026/05/25-31/05-31/actions/messages/email_Jane-Doe_Atlas.md',
    actual: resolveTimeRef('time/2026/05/25-31/31/actions/messages/email_Jane-Doe_Atlas.md'),
  })
})

test('resolveTimeRef repairs an x-marked spillover path', () => {
  assert({
    given: 'a legacy xDD path for a July day filed under a June week',
    should: "resolve to the day's real dir in the week it belongs to",
    expected: 'time/2026/06/29-05/07-01/actions/messages/slack_Jane_topic.md',
    actual: resolveTimeRef('time/2026/06/29-05/x01/actions/messages/slack_Jane_topic.md'),
  })
})

test('resolveTimeRef passes a current-layout path through itself', () => {
  const current = 'time/2026/08/10-16/08-10/actions/messages/email_Jane-Doe_Atlas.md'

  assert({
    given: 'a path already in the current layout',
    should: 'resolve to itself — normalize-then-resolve is a fixed point',
    expected: current,
    actual: resolveTimeRef(current),
  })
})

// --- isTimeRef ---

test('isTimeRef tells refs from paths', () => {
  assert({
    given: 'a ref, a path, and a bare date',
    should: 'accept only the ref form',
    expected: [true, false, false],
    actual: [
      isTimeRef('2026-05-31/actions/messages/x.md'),
      isTimeRef('time/2026/05/25-31/05-31/actions/messages/x.md'),
      isTimeRef('2026-05-31'),
    ],
  })
})

test('toTimeRef reduces a v2 path to its ref', () => {
  assert({
    given: 'a v2 path with a bare week dir',
    should: 'read year and day dir directly',
    actual: toTimeRef('time/2026/W14/04-01/actions/meetings/atlas-sync.md'),
    expected: '2026-04-01/actions/meetings/atlas-sync.md',
  })
  assert({
    given: 'a v2 path with a month-labeled week dir',
    should: 'ignore the label',
    actual: toTimeRef('time/2026/03-W14/03-31/day.md'),
    expected: '2026-03-31/day.md',
  })
})

test('toTimeRef arbitrates the v1.1 year-boundary artifact by week range', () => {
  assert({
    given: 'a January day filed under the previous year by week:new (2025/12/29-04/01-02)',
    should: 'bump to the true year',
    actual: toTimeRef('time/2025/12/29-04/01-02/day.md'),
    expected: '2026-01-02/day.md',
  })
  assert({
    given: 'the same date correctly filed under its own year (2026/12/29-04/01-02)',
    should: 'keep the path year',
    actual: toTimeRef('time/2026/12/29-04/01-02/day.md'),
    expected: '2026-01-02/day.md',
  })
})
