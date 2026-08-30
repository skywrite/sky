import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { captureMoment } from './moment.ts'

const CHICAGO = 'America/Chicago'

function stamp(moment: { date: { ymd: string }; time: string }): string {
  return `${moment.date.ymd} ${moment.time}`
}

test('captureMoment: same zone keeps the calendar day and unpads the hour', () => {
  assert({
    given: '06:12 on a Sunday morning, notebook in the same zone',
    should: 'stamp that Sunday at 6:12 — not the open day at 30:12',
    expected: '2026-08-30 6:12',
    actual: stamp(captureMoment(new ZonedDateTime('2026-08-30 06:12', CHICAGO), CHICAGO)),
  })
  assert({
    given: '18:05 the same day',
    should: 'leave two-digit hours alone',
    expected: '2026-08-30 18:05',
    actual: stamp(captureMoment(new ZonedDateTime('2026-08-30 18:05', CHICAGO), CHICAGO)),
  })
})

test('captureMoment: converts into the notebook zone and rolls across midnight', () => {
  assert({
    given: 'system clock on UTC at 03:47 Sunday, notebook in Chicago (UTC-5 in August)',
    should: 'stamp Saturday 22:47',
    expected: '2026-08-29 22:47',
    actual: stamp(captureMoment(new ZonedDateTime('2026-08-30 03:47', 'UTC'), CHICAGO)),
  })
  assert({
    given: 'system clock in Los Angeles at 23:31 Saturday, notebook in Tokyo',
    should: 'stamp Sunday 15:31',
    expected: '2026-08-30 15:31',
    actual: stamp(captureMoment(new ZonedDateTime('2026-08-29 23:31', 'America/Los_Angeles'), 'Asia/Tokyo')),
  })
})
