import { assert, test } from '#test'
import {
  computeNeedsResponsePriority,
  isNeedsResponseExpired,
  NEEDS_RESPONSE_EXPIRY_DAYS,
  passesNeedsResponseScreen,
  sortNeedsResponseItems,
} from './score.ts'
import type { NeedsResponseItem } from './types.ts'

test('older unanswered messages bubble ahead of newer ones from equally scored contacts', () => {
  const fresh = computeNeedsResponsePriority({ personScore: 200, ageHours: 1, kind: 'dm' })
  const dayOld = computeNeedsResponsePriority({ personScore: 200, ageHours: 24, kind: 'dm' })
  const threeDaysOld = computeNeedsResponsePriority({ personScore: 200, ageHours: 72, kind: 'dm' })

  assert({
    given: 'messages from equally scored contacts waiting 1h, 24h, and 72h',
    should: 'rank older unanswered messages strictly higher',
    actual: [dayOld > fresh, threeDaysOld > dayOld],
    expected: [true, true],
  })
})

test('person importance leads so low-score stale pings never drown out VIPs, while overdue peers still bubble up', () => {
  const vipFresh = computeNeedsResponsePriority({ personScore: 900, ageHours: 1, kind: 'dm' })
  const vipDayOld = computeNeedsResponsePriority({ personScore: 900, ageHours: 24, kind: 'dm' })
  const closeTeammateSixDays = computeNeedsResponsePriority({ personScore: 250, ageHours: 144, kind: 'dm' })
  const acquaintanceSixDays = computeNeedsResponsePriority({ personScore: 15, ageHours: 144, kind: 'dm' })
  const dm = computeNeedsResponsePriority({ personScore: 100, ageHours: 4, kind: 'dm' })
  const group = computeNeedsResponsePriority({ personScore: 100, ageHours: 4, kind: 'group' })
  const macContactUnscored = computeNeedsResponsePriority({
    personScore: 0,
    ageHours: 4,
    kind: 'dm',
    inMacContacts: true,
  })
  const nonContactLow = computeNeedsResponsePriority({
    personScore: 10,
    ageHours: 4,
    kind: 'dm',
    inMacContacts: false,
  })
  const macContactBoosted = computeNeedsResponsePriority({
    personScore: 100,
    ageHours: 4,
    kind: 'dm',
    inMacContacts: true,
  })

  assert({
    given:
      'a VIP, a very overdue close teammate, a very overdue acquaintance, Mac Contacts, and direct vs group messages',
    should:
      'keep VIPs ahead of stale acquaintances, elevate Mac Contacts with bonus points, allow a 6d close teammate above a 1h VIP, and lift direct pings',
    actual: [
      vipFresh > acquaintanceSixDays,
      closeTeammateSixDays > vipFresh,
      vipDayOld > closeTeammateSixDays,
      dm > group,
      macContactUnscored > nonContactLow,
      macContactBoosted > dm,
    ],
    expected: [true, true, true, true, true, true],
  })
})

test('7-day expiry and Jev screen thresholds behave cleanly at boundaries', () => {
  assert({
    given: 'ages just below and at the 7-day cap',
    should: 'expire at 168 hours (7 days)',
    actual: [
      isNeedsResponseExpired(NEEDS_RESPONSE_EXPIRY_DAYS * 24 - 0.1),
      isNeedsResponseExpired(NEEDS_RESPONSE_EXPIRY_DAYS * 24),
    ],
    expected: [false, true],
  })

  assert({
    given: 'Jev screen verdicts around the admission cutoffs',
    should: 'require both needsResponse and ownerAddressed thresholds to pass',
    actual: [
      passesNeedsResponseScreen({ needsResponse: 0.7, ownerAddressed: 0.8 }),
      passesNeedsResponseScreen({ needsResponse: 0.3, ownerAddressed: 0.9 }),
      passesNeedsResponseScreen({ needsResponse: 0.8, ownerAddressed: 0.2 }),
    ],
    expected: [true, false, false],
  })
})

test('sortNeedsResponseItems sorts by priority descending then oldest received first', () => {
  const make = (overrides: Partial<NeedsResponseItem> & { id: string }): NeedsResponseItem => ({
    version: 'v1',
    source: 'Slack',
    kind: 'dm',
    sender: 'Jane Doe',
    summary: 'Quick question',
    receivedAt: '2025-03-14T12:00:00Z',
    receivedLocal: '2025-03-14 12:00',
    ageHours: 10,
    points: 80,
    dropsInMinutes: 120,
    personScore: 100,
    priority: 10,
    href: 'https://example.slack.com/archives/D1/p1',
    ...overrides,
  })

  const sorted = sortNeedsResponseItems([
    make({ id: 'b', priority: 10, receivedAt: '2025-03-14T15:00:00Z' }),
    make({ id: 'a', priority: 10, receivedAt: '2025-03-14T10:00:00Z' }),
    make({ id: 'c', priority: 14, receivedAt: '2025-03-15T01:00:00Z' }),
  ])

  assert({
    given: 'items with distinct and tied priorities',
    should: 'order highest priority first and break ties with oldest received first',
    actual: sorted.map((item) => item.id),
    expected: ['c', 'a', 'b'],
  })
})
