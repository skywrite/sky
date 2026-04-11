import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { INTERACTION_WEIGHTS, RECENCY_MULTIPLIERS, RECENCY_THRESHOLDS, Store } from './store.ts'

// =============================================================================
// calculateRecencyMultiplier tests
// =============================================================================

const recencyFixtures = [
  // Week threshold (0-7 days)
  {
    daysSince: 0,
    expected: RECENCY_MULTIPLIERS.week,
    description: 'today (0 days)',
  },
  {
    daysSince: 1,
    expected: RECENCY_MULTIPLIERS.week,
    description: '1 day ago',
  },
  {
    daysSince: 7,
    expected: RECENCY_MULTIPLIERS.week,
    description: 'exactly 7 days (boundary)',
  },
  // Month threshold (8-30 days)
  {
    daysSince: 8,
    expected: RECENCY_MULTIPLIERS.month,
    description: '8 days (first day of month tier)',
  },
  {
    daysSince: 30,
    expected: RECENCY_MULTIPLIERS.month,
    description: 'exactly 30 days (boundary)',
  },
  // Quarter threshold (31-90 days)
  {
    daysSince: 31,
    expected: RECENCY_MULTIPLIERS.quarter,
    description: '31 days (first day of quarter tier)',
  },
  {
    daysSince: 90,
    expected: RECENCY_MULTIPLIERS.quarter,
    description: 'exactly 90 days (boundary)',
  },
  // Year threshold (91-365 days)
  {
    daysSince: 91,
    expected: RECENCY_MULTIPLIERS.year,
    description: '91 days (first day of year tier)',
  },
  {
    daysSince: 365,
    expected: RECENCY_MULTIPLIERS.year,
    description: 'exactly 365 days (boundary)',
  },
  // Older (>365 days)
  {
    daysSince: 366,
    expected: RECENCY_MULTIPLIERS.older,
    description: '366 days (first day of older tier)',
  },
  {
    daysSince: 1000,
    expected: RECENCY_MULTIPLIERS.older,
    description: '1000 days ago',
  },
]

recencyFixtures.forEach((fixture) => {
  test(`calculateRecencyMultiplier - ${fixture.description}`, () => {
    const store = new Store()
    const today = new PlainDate(2026, 1, 27)
    const interactionDate = today.addDays(-fixture.daysSince)

    assert({
      given: `an interaction ${fixture.daysSince} days ago`,
      should: `return multiplier ${fixture.expected}`,
      actual: store.calculateRecencyMultiplier(interactionDate.ymd, today),
      expected: fixture.expected,
    })
  })
})

// =============================================================================
// recordInteraction / recordOrgInteraction scoring tests
// =============================================================================

const scoringFixtures = [
  {
    description: 'single meeting interaction today',
    interactions: [{ daysAgo: 0, weight: INTERACTION_WEIGHTS.meeting }],
    expectedScore: INTERACTION_WEIGHTS.meeting * RECENCY_MULTIPLIERS.week,
    expectedCount: 1,
  },
  {
    description: 'single email interaction 15 days ago',
    interactions: [{ daysAgo: 15, weight: INTERACTION_WEIGHTS.email }],
    expectedScore: INTERACTION_WEIGHTS.email * RECENCY_MULTIPLIERS.month,
    expectedCount: 1,
  },
  {
    description: 'multiple interactions compound',
    interactions: [
      { daysAgo: 0, weight: INTERACTION_WEIGHTS.meeting },
      { daysAgo: 5, weight: INTERACTION_WEIGHTS.slack },
      { daysAgo: 10, weight: INTERACTION_WEIGHTS.email },
    ],
    expectedScore:
      INTERACTION_WEIGHTS.meeting * RECENCY_MULTIPLIERS.week +
      INTERACTION_WEIGHTS.slack * RECENCY_MULTIPLIERS.week +
      INTERACTION_WEIGHTS.email * RECENCY_MULTIPLIERS.month,
    expectedCount: 3,
  },
  {
    description: 'old interaction has minimal impact',
    interactions: [{ daysAgo: 400, weight: INTERACTION_WEIGHTS.meeting }],
    expectedScore: INTERACTION_WEIGHTS.meeting * RECENCY_MULTIPLIERS.older,
    expectedCount: 1,
  },
]

scoringFixtures.forEach((fixture) => {
  test(`recordInteraction (person) - ${fixture.description}`, () => {
    const store = new Store()
    const today = new PlainDate(2026, 1, 27)
    const personName = 'Test Person'

    // Record all interactions, passing today for deterministic scoring
    fixture.interactions.forEach(({ daysAgo, weight }) => {
      const date = today.addDays(-daysAgo)
      store.recordInteraction(personName, date.ymd, weight, today)
    })

    const score = store.personScores.get(personName)

    assert({
      given: fixture.description,
      should: `have score ${fixture.expectedScore}`,
      actual: score?.score,
      expected: fixture.expectedScore,
    })

    assert({
      given: fixture.description,
      should: `have interaction count ${fixture.expectedCount}`,
      actual: score?.interactionCount,
      expected: fixture.expectedCount,
    })
  })

  test(`recordOrgInteraction - ${fixture.description}`, () => {
    const store = new Store()
    const today = new PlainDate(2026, 1, 27)
    const orgName = 'Test Org'

    // Record all interactions, passing today for deterministic scoring
    fixture.interactions.forEach(({ daysAgo, weight }) => {
      const date = today.addDays(-daysAgo)
      store.recordOrgInteraction(orgName, date.ymd, weight, today)
    })

    const score = store.orgScores.get(orgName)

    assert({
      given: fixture.description,
      should: `have score ${fixture.expectedScore}`,
      actual: score?.score,
      expected: fixture.expectedScore,
    })

    assert({
      given: fixture.description,
      should: `have interaction count ${fixture.expectedCount}`,
      actual: score?.interactionCount,
      expected: fixture.expectedCount,
    })
  })
})

// =============================================================================
// getPeopleWithScores / getOrganizationsWithScores sorting tests
// =============================================================================

test('getPeopleWithScores - sorts by score descending, then name ascending', () => {
  const store = new Store()

  // Add people to the set
  store.people.add('Alice')
  store.people.add('Bob')
  store.people.add('Charlie')
  store.people.add('Diana')

  // Set scores directly for deterministic testing
  store.personScores.set('Alice', { name: 'Alice', score: 50, lastInteraction: '2026-01-20', interactionCount: 5 })
  store.personScores.set('Bob', { name: 'Bob', score: 100, lastInteraction: '2026-01-25', interactionCount: 10 })
  store.personScores.set('Charlie', { name: 'Charlie', score: 50, lastInteraction: '2026-01-15', interactionCount: 3 })
  // Diana has no score entry - should appear with score 0

  const result = store.getPeopleWithScores()
  const names = result.map((p) => p.name)
  const scores = result.map((p) => p.score)

  assert({
    given: 'people with various scores',
    should: 'sort by score desc, then name asc',
    actual: names,
    expected: ['Bob', 'Alice', 'Charlie', 'Diana'],
  })

  assert({
    given: 'people with various scores',
    should: 'have correct scores in order',
    actual: scores,
    expected: [100, 50, 50, 0],
  })
})

test('getOrganizationsWithScores - sorts by score descending, then name ascending', () => {
  const store = new Store()

  // Add orgs to the set
  store.organizations.add('Acme Inc')
  store.organizations.add('Beta Corp')
  store.organizations.add('Alpha LLC')
  store.organizations.add('Zeta Ltd')

  // Set scores directly
  store.orgScores.set('Acme Inc', { name: 'Acme Inc', score: 75, lastInteraction: '2026-01-20', interactionCount: 5 })
  store.orgScores.set('Beta Corp', {
    name: 'Beta Corp',
    score: 75,
    lastInteraction: '2026-01-25',
    interactionCount: 10,
  })
  store.orgScores.set('Alpha LLC', {
    name: 'Alpha LLC',
    score: 100,
    lastInteraction: '2026-01-15',
    interactionCount: 3,
  })
  // Zeta Ltd has no score entry - should appear with score 0

  const result = store.getOrganizationsWithScores()
  const names = result.map((o) => o.name)
  const scores = result.map((o) => o.score)

  assert({
    given: 'orgs with various scores',
    should: 'sort by score desc, then name asc',
    actual: names,
    expected: ['Alpha LLC', 'Acme Inc', 'Beta Corp', 'Zeta Ltd'],
  })

  assert({
    given: 'orgs with various scores',
    should: 'have correct scores in order',
    actual: scores,
    expected: [100, 75, 75, 0],
  })
})

// =============================================================================
// Constants verification tests
// =============================================================================

test('RECENCY_THRESHOLDS - boundaries are correctly ordered', () => {
  assert({
    given: 'recency thresholds',
    should: 'have week < month < quarter < year',
    actual:
      RECENCY_THRESHOLDS.week < RECENCY_THRESHOLDS.month &&
      RECENCY_THRESHOLDS.month < RECENCY_THRESHOLDS.quarter &&
      RECENCY_THRESHOLDS.quarter < RECENCY_THRESHOLDS.year,
    expected: true,
  })
})

test('RECENCY_MULTIPLIERS - values decay correctly', () => {
  assert({
    given: 'recency multipliers',
    should: 'have week > month > quarter > year > older',
    actual:
      RECENCY_MULTIPLIERS.week > RECENCY_MULTIPLIERS.month &&
      RECENCY_MULTIPLIERS.month > RECENCY_MULTIPLIERS.quarter &&
      RECENCY_MULTIPLIERS.quarter > RECENCY_MULTIPLIERS.year &&
      RECENCY_MULTIPLIERS.year > RECENCY_MULTIPLIERS.older,
    expected: true,
  })
})

test('INTERACTION_WEIGHTS - meeting/project are highest priority', () => {
  assert({
    given: 'interaction weights',
    should: 'have meeting and project as highest weight',
    actual: INTERACTION_WEIGHTS.meeting === INTERACTION_WEIGHTS.project,
    expected: true,
  })

  assert({
    given: 'interaction weights',
    should: 'have meeting > email > slack > day',
    actual:
      INTERACTION_WEIGHTS.meeting > INTERACTION_WEIGHTS.email &&
      INTERACTION_WEIGHTS.email > INTERACTION_WEIGHTS.slack &&
      INTERACTION_WEIGHTS.slack > INTERACTION_WEIGHTS.day,
    expected: true,
  })
})
