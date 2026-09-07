import { assert, test } from '#test'
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
