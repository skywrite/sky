import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import meetingFileName from './meetingFileName.ts'

test('meetingFileName', async () => {
  assert({
    given: 'a meeting start time and a medium_who_summary slug',
    should: 'name the file HH-MM_slug.md under actions/meetings',
    expected: 'actions/meetings/11-00_Zoom_Jane-Doe_Atlas-Q3-roadmap.md',
    actual: meetingFileName(new PlainDateTime('2026-07-27 11:00'), 'Zoom_Jane-Doe_Atlas-Q3-roadmap'),
  })

  assert({
    given: 'a meeting with no summary',
    should: 'still take the prefix, leaving the shorter slug intact',
    expected: 'actions/meetings/09-15_In-Person_Jane-Doe.md',
    actual: meetingFileName(new PlainDateTime('2026-07-27 09:15'), 'In-Person_Jane-Doe'),
  })

  assert({
    given: 'a midnight meeting start',
    should: 'zero-pad the hour rather than drop the prefix',
    expected: 'actions/meetings/00-00_Phone_Jane-Doe_Overnight-handoff.md',
    actual: meetingFileName(new PlainDateTime('2026-07-27 00:00'), 'Phone_Jane-Doe_Overnight-handoff'),
  })

  // Extended hours are real: a call that starts at 25:15 belongs to the day it
  // started on, and the name must say so rather than wrap to 01-15.
  assert({
    given: 'an extended-hours start past 24:00',
    should: 'keep the hour as recorded',
    expected: 'actions/meetings/25-15_Zoom_Jane-Doe_Late-night-cutover.md',
    actual: meetingFileName(new PlainDateTime('2026-07-27 25:15'), 'Zoom_Jane-Doe_Late-night-cutover'),
  })

  // Sorting the directory is the whole point of the prefix: a listing must come
  // back in the order the day happened, not grouped by medium.
  const day = [
    meetingFileName(new PlainDateTime('2026-07-27 16:30'), 'Zoom_Zed_Late-review'),
    meetingFileName(new PlainDateTime('2026-07-27 25:15'), 'Phone_Alice_After-hours'),
    meetingFileName(new PlainDateTime('2026-07-27 09:00'), 'Phone_Alice_Standup'),
  ]

  assert({
    given: 'meeting names from one day sorted lexically',
    should: 'come back in chronological order, extended hours last',
    expected: ['09-00', '16-30', '25-15'],
    actual: [...day].sort().map((f) => f.slice('actions/meetings/'.length, 'actions/meetings/'.length + 5)),
  })
})
