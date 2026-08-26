import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import {
  appendCheckin,
  dayNumberInWeek,
  entryHeading,
  fenceFor,
  renderCheckinsFile,
  unpadHour,
} from './checkinsMarkdown.ts'

const WEEK = Week.from(2026, 10) // Mon 2026-03-02 – Sun 2026-03-08

test('fenceFor - plain content gets the four-backtick floor', () => {
  assert({
    given: 'content with no backtick runs',
    should: 'return four backticks',
    actual: fenceFor('# Plan\n\n- a goal'),
    expected: '````',
  })
})

test('fenceFor - outruns the longest run in the content', () => {
  assert({
    given: 'content containing a four-backtick fence',
    should: 'return five backticks',
    actual: fenceFor('before\n````csv\na,b\n````\nafter'),
    expected: '`````',
  })
})

test('unpadHour - strips the leading zero only', () => {
  assert({
    given: 'padded, unpadded, and extended-hours times',
    should: 'unpad 09:05, keep 14:30 and 25:30',
    actual: [unpadHour('09:05'), unpadHour('14:30'), unpadHour('25:30')].join(' '),
    expected: '9:05 14:30 25:30',
  })
})

test('dayNumberInWeek - inside and outside the week', () => {
  assert({
    given: 'the Tuesday of the week and a day after it ended',
    should: 'return 2 and undefined',
    actual: `${dayNumberInWeek(WEEK, new PlainDate(2026, 3, 3))} ${dayNumberInWeek(WEEK, new PlainDate(2026, 3, 12))}`,
    expected: '2 undefined',
  })
})

test('entryHeading - mid-week run', () => {
  assert({
    given: 'a Tuesday 09:40 checkin',
    should: 'stamp weekday, date, unpadded time, and day position',
    actual: entryHeading(WEEK, new PlainDate(2026, 3, 3), '09:40'),
    expected: '## Checkin — Tue 2026-03-03 9:40 (day 2 of 7)',
  })
})

test('entryHeading - run after the week ended', () => {
  assert({
    given: 'a checkin run the Thursday after',
    should: 'mark the entry as the final reckoning',
    actual: entryHeading(WEEK, new PlainDate(2026, 3, 12), '8:00'),
    expected: '## Checkin — Thu 2026-03-12 8:00 (after week end — final reckoning)',
  })
})

test('renderCheckinsFile - snapshot preserved verbatim inside the fence', () => {
  const plan = '---\ncreated: 2026-03-02\n---\n\n# 2026-W10: Week Plan\n\n## Goals\n\n- ship the widget\n'
  const file = renderCheckinsFile(WEEK, '2026-03-03', plan, '## Checkin — Tue 2026-03-03 9:40 (day 2 of 7)\n\nbody')

  assert({
    given: 'a first checkin creating the file',
    should: 'carry frontmatter, the H1, the fenced verbatim plan, and the entry',
    actual: [
      file.startsWith('---\ncreated: 2026-03-03\nupdated: 2026-03-03\n---'),
      file.includes('# 2026-W10: Checkins'),
      file.includes('## Plan snapshot — captured 2026-03-03'),
      file.includes(`\`\`\`\`markdown\n${plan.trimEnd()}\n\`\`\`\``),
      file.trimEnd().endsWith('body'),
    ].join(' '),
    expected: 'true true true true true',
  })
})

test('appendCheckin - bumps updated, keeps created, appends with one blank line', () => {
  const existing = '---\ncreated: 2026-03-03\nupdated: 2026-03-03\n---\n\n# 2026-W10: Checkins\n\nfirst entry\n'
  const appended = appendCheckin(existing, '## Checkin — Thu 2026-03-05 7:10 (day 4 of 7)\n\nsecond', '2026-03-05')

  assert({
    given: 'an existing checkins.md and a new entry',
    should: 'bump only updated: and append the entry after one blank line',
    actual: [
      appended.startsWith('---\ncreated: 2026-03-03\nupdated: 2026-03-05\n---'),
      appended.includes('first entry\n\n## Checkin — Thu 2026-03-05'),
      appended.endsWith('second\n'),
    ].join(' '),
    expected: 'true true true',
  })
})

test('appendCheckin - a file without frontmatter still takes the append', () => {
  const appended = appendCheckin('# 2026-W10: Checkins\n\nfirst\n', '## Checkin\n\nsecond', '2026-03-05')

  assert({
    given: 'a hand-stripped file with no frontmatter',
    should: 'append unchanged rather than fail',
    actual: appended,
    expected: '# 2026-W10: Checkins\n\nfirst\n\n## Checkin\n\nsecond\n',
  })
})
