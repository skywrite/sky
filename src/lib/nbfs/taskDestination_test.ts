import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { commandPlanningDate, taskFiling } from './taskDestination.ts'

test('task filing uses Sunday as its boundary, including New Year and extended notebook hours', () => {
  assert({
    given: 'Sunday/Monday targets and a week crossing New Year',
    should: 'keep the entire current calendar week on days and route later dates to the schedule',
    actual: [
      taskFiling(new PlainDate('2031-03-16'), new PlainDate('2031-03-13')),
      taskFiling(new PlainDate('2031-03-17'), new PlainDate('2031-03-13')),
      taskFiling(new PlainDate('2032-01-04'), new PlainDate('2031-12-31')),
      taskFiling(new PlainDate('2032-01-05'), new PlainDate('2031-12-31')),
    ],
    expected: ['day', 'schedule', 'day', 'schedule'],
  })
  const systemNow = new ZonedDateTime('2031-03-17T01:30:00', 'UTC')
  assert({
    given: 'an open Sunday at 25:30 and a notebook without any started day',
    should: 'use Monday in both cases',
    actual: [
      commandPlanningDate({ notebookNow: new ZonedDateTime('2031-03-16T25:30:00', 'UTC'), systemNow }).ymd,
      commandPlanningDate({
        get notebookNow(): ZonedDateTime {
          throw new Error('No started day')
        },
        systemNow,
      }).ymd,
    ],
    expected: ['2031-03-17', '2031-03-17'],
  })
})
