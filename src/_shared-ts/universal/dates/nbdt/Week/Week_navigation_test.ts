import { assert, test } from '#test'
import Week from './mod.ts'

test('Week - mid-year next/previous round-trip', () => {
  const week = Week.of('2026-08-11')

  assert({
    given: '2026-W33.next()',
    should: 'be 2026-W34',
    actual: week.next().toString(),
    expected: '2026-W34',
  })
  assert({
    given: '2026-W33.next().previous()',
    should: 'round-trip back',
    actual: week.next().previous().equals(week),
    expected: true,
  })
})

test('Week - navigation chains across year boundaries', () => {
  const chains = [
    {
      from: '2026-W52',
      via: ['2026-W53', '2027-W00', '2027-W01'],
      description: 'genuine W53, then W00',
    },
    {
      from: '2023-W52',
      via: ['2024-W01'],
      description: 'clean Sunday end, straight to W01',
    },
    {
      from: '2025-W52',
      via: ['2025-W53', '2026-W01'],
      description: 'overflow W53, no W00 in 2026',
    },
    {
      from: '2021-W52',
      via: ['2022-W00', '2022-W01'],
      description: 'clipped W52 straight to W00',
    },
    {
      from: '2012-W52',
      via: ['2012-W53', '2013-W01'],
      description: 'maximal year 2012, no W00 in 2013',
    },
  ]

  for (const { from, via, description } of chains) {
    let week = Week.parse(from)
    const walked: string[] = []
    for (let i = 0; i < via.length; i++) {
      week = week.next()
      walked.push(week.toString())
    }
    assert({
      given: `${from} stepped forward ${via.length}x (${description})`,
      should: `walk ${via.join(' -> ')}`,
      actual: walked.join(' -> '),
      expected: via.join(' -> '),
    })

    for (let i = 0; i < via.length; i++) {
      week = week.previous()
    }
    assert({
      given: `${via[via.length - 1]} stepped back ${via.length}x`,
      should: `return to ${from}`,
      actual: week.toString(),
      expected: from,
    })
  }
})
