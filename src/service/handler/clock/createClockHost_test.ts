import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { convertAnswerOf } from './createClockHost.ts'

test('clock conversion keeps distinct places in the same timezone through date normalization', () => {
  const local = new ZonedDateTime({ date: '2026-02-10', time: '23:30', timezone: 'America/New_York' })
  const target = local.inTimeZone('Europe/Paris')
  const utc = local.toUTC()
  const answers = ['Harbor City', 'Lake Town'].map((targetName) => convertAnswerOf({ local, target, utc, targetName }))

  assert({
    given: 'two requested places sharing an IANA timezone, with a conversion crossing midnight',
    should: 'retain each place name beside the same timezone and normalized reading',
    actual: answers.map((answer) => answer.target),
    expected: [
      { date: '2026-02-11', time: '05:30', timezone: 'Europe/Paris', place: 'Harbor City' },
      { date: '2026-02-11', time: '05:30', timezone: 'Europe/Paris', place: 'Lake Town' },
    ],
  })

  assert({
    given: 'the same converted instant',
    should: 'keep local and UTC readings independent of the requested place',
    actual: { local: answers[0]!.local, utc: answers[0]!.utc },
    expected: {
      local: { date: '2026-02-10', time: '23:30', timezone: 'America/New_York' },
      utc: { date: '2026-02-11', time: '04:30', timezone: 'UTC' },
    },
  })
})
