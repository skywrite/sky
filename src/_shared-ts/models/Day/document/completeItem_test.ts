import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

// =============================================================================
// getCompleteItem
// =============================================================================

const dayWithSlackItems = `
# **2026-01-28 - Tue**

## Professional Complete
- 09:00 > Kevin to #general Slack -> [discussed roadmap](actions/messages/slack_Kevin_discussed-roadmap.md)
- 10:30 > Alice Slack -> [quick update](actions/messages/slack_Alice_quick-update.md)
- 14:00 > Meeting with team -> [standup](actions/meetings/standup.md)
`

test('DayDocument.getCompleteItem() finds item by exact key', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const result = day.getCompleteItem('09:00 > Kevin to #general Slack')

  assert({
    given: 'a day with Slack items and exact key match',
    should: 'return the matching item ref',
    actual: result?.path,
    expected: 'actions/messages/slack_Kevin_discussed-roadmap.md',
  })
})

test('DayDocument.getCompleteItem() returns full CompleteItemRef structure', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const result = day.getCompleteItem('09:00 > Kevin to #general Slack')

  assert({
    given: 'a matching item',
    should: 'return key, link, path, title, and raw',
    actual: {
      key: result?.key,
      link: result?.link,
      path: result?.path,
      title: result?.title,
      hasRaw: !!result?.raw,
    },
    expected: {
      key: '09:00 > Kevin to #general Slack',
      link: '[discussed roadmap](actions/messages/slack_Kevin_discussed-roadmap.md)',
      path: 'actions/messages/slack_Kevin_discussed-roadmap.md',
      title: 'discussed roadmap',
      hasRaw: true,
    },
  })
})

test('DayDocument.getCompleteItem() returns undefined for non-matching key', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const result = day.getCompleteItem('09:00 > Bob Slack')

  assert({
    given: 'a key that does not exist',
    should: 'return undefined',
    actual: result,
    expected: undefined,
  })
})

test('DayDocument.getCompleteItem() respects category filter', () => {
  const dayWithCategories = `
# **2026-01-28 - Tue**

## Professional Complete
- 09:00 > Kevin Slack -> [work stuff](actions/messages/slack_Kevin.md)

## Personal Complete
- 09:00 > Kevin Slack -> [personal stuff](actions/messages/slack_Kevin_personal.md)
`
  const day = DayDocument.fromMarkdown(dayWithCategories)

  const professionalResult = day.getCompleteItem('09:00 > Kevin Slack', 'Professional')
  const personalResult = day.getCompleteItem('09:00 > Kevin Slack', 'Personal')

  assert({
    given: 'same key in different categories',
    should: 'return item from specified category',
    actual: [professionalResult?.title, personalResult?.title],
    expected: ['work stuff', 'personal stuff'],
  })
})

// =============================================================================
// setCompleteItem
// =============================================================================

test('DayDocument.setCompleteItem() replaces existing item', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const result = day.setCompleteItem(
    '09:00 > Kevin to #general Slack',
    '[updated summary](actions/messages/slack_Kevin_updated.md)',
    { time: '09:00', category: 'Professional' },
  )

  const completeList = result.lists.find((l) => l.title === 'Professional Complete')
  const hasOld = completeList?.items.some((i) => i.includes('discussed roadmap'))
  const hasNew = completeList?.items.some((i) => i.includes('updated summary'))

  assert({
    given: 'an existing item key',
    should: 'replace old item with new one',
    actual: { hasOld, hasNew },
    expected: { hasOld: false, hasNew: true },
  })
})

test('DayDocument.setCompleteItem() adds new item when key not found', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const result = day.setCompleteItem('11:00 > Bob Slack', '[new message](actions/messages/slack_Bob.md)', {
    time: '11:00',
    category: 'Professional',
  })

  const completeList = result.lists.find((l) => l.title === 'Professional Complete')
  const hasNew = completeList?.items.some((i) => i.includes('Bob Slack'))

  assert({
    given: 'a key that does not exist',
    should: 'add new item',
    actual: hasNew,
    expected: true,
  })
})

test('DayDocument.setCompleteItem() maintains item count when replacing', () => {
  const day = DayDocument.fromMarkdown(dayWithSlackItems)
  const completeListBefore = day.lists.find((l) => l.title === 'Professional Complete')
  const countBefore = completeListBefore?.items.length ?? 0

  const result = day.setCompleteItem(
    '09:00 > Kevin to #general Slack',
    '[updated](actions/messages/slack_Kevin_updated.md)',
    { time: '09:00', category: 'Professional' },
  )

  const completeListAfter = result.lists.find((l) => l.title === 'Professional Complete')
  const countAfter = completeListAfter?.items.length ?? 0

  assert({
    given: 'replacing an existing item',
    should: 'keep the same item count',
    actual: countAfter,
    expected: countBefore,
  })
})
