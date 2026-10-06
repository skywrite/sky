import { assert, test } from '#test'
import { parseMeetingEntry } from './meetings.ts'
import DayDocument from './mod.ts'

test('day meetings include inline notes and linked files, excluding plans and other captures', () => {
  const day = DayDocument.fromMarkdown(`---
date: 2026-01-27
---
## Professional Complete
- 10:00 > Jane Doe Zoom -> discussed next steps
- 11:00 > Alex Chen In Person -> [Planning](actions/meetings/planning.md)
- 12:00 > Jane Doe Slack -> sent a message
- 13:00 > Notes -> wrote a note
- 25:30 > Jane Doe FT Audio -> late call
## Professional Incomplete
- 14:00 > Jane Doe Zoom -> planned call
`)
  assert({
    given: 'inline and linked meetings among other day entries',
    should: 'extract only completed meetings, retaining notes and optional links',
    actual: day.meetings,
    expected: [
      {
        time: '10:00',
        who: 'Jane Doe',
        medium: 'Zoom',
        title: 'Jane Doe Zoom',
        notes: 'discussed next steps',
        path: null,
      },
      {
        time: '11:00',
        who: 'Alex Chen',
        medium: 'In Person',
        title: 'Planning',
        notes: '[Planning](actions/meetings/planning.md)',
        path: 'actions/meetings/planning.md',
      },
      {
        time: '25:30',
        who: 'Jane Doe',
        medium: 'FT Audio',
        title: 'Jane Doe FT Audio',
        notes: 'late call',
        path: null,
      },
    ],
  })
})

test('meeting entries retain parenthesized and legacy durations, including extended hours', () => {
  const entries = [
    '10:15(45m) > Jane Doe In Person -> Reviewed the launch plan',
    '10:15 45m > Jane Doe In Person -> Reviewed the launch plan',
    '25:15 (1h 30m) > Jane Doe Phone -> Reviewed the launch plan',
  ]
  assert({
    given: 'meeting notes with minute, compound and legacy durations',
    should: 'retain the time, duration, participant, medium and notes',
    actual: entries.map(parseMeetingEntry),
    expected: entries.map((_, index) => ({
      time: index === 2 ? '25:15' : '10:15',
      minutes: index === 2 ? 90 : 45,
      who: 'Jane Doe',
      medium: index === 2 ? 'Phone' : 'In Person',
      title: index === 2 ? 'Jane Doe Phone' : 'Jane Doe In Person',
      notes: 'Reviewed the launch plan',
      path: null,
    })),
  })
  assert({
    given: 'invalid lengths and ordinary activities containing an arrow',
    should: 'not classify them as meetings',
    actual: [
      '10:15(soon) > Jane Doe In Person -> Reviewed the launch plan',
      '10:15(0m) > Jane Doe In Person -> Reviewed the launch plan',
      '10:15(45m) > Draft -> Revised the launch plan',
    ].map(parseMeetingEntry),
    expected: [null, null, null],
  })
})
