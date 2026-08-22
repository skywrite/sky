import { assert, test } from '#test'
import { normalizeActionItems, parseActionItemsSection } from './actionItems.ts'

const BODY = `# Renewal Terms for the Atlas Account

## Time/Date

2026-08-19 10:00

## Attendees

Jane Doe, Alex Chen

## Meeting Summary

Discussed renewal terms and the rollout timeline.

## Action Items

- Send the revised Atlas proposal to Jane Doe by Friday (me)
- (me) Review the Q3 pricing draft
- Alex Chen: schedule the vendor call
* Confirm the rollout date with the platform team (me, by end of month)
- Prepare the onboarding checklist
  covering the first two weeks

## Important Questions

- Jane Doe asked who owns the rollout comms.
`

test('parseActionItemsSection() - full body', () => {
  const items = parseActionItemsSection(BODY)

  assert({
    given: 'a summary body with a mixed Action Items section',
    should: 'return one item per bullet, in order, continuation folded in',
    actual: items.map((i) => i.text),
    expected: [
      'Send the revised Atlas proposal to Jane Doe by Friday',
      'Review the Q3 pricing draft',
      'Alex Chen: schedule the vendor call',
      'Confirm the rollout date with the platform team (by end of month)',
      'Prepare the onboarding checklist covering the first two weeks',
    ],
  })

  assert({
    given: 'bullets with "(me)" trailing, leading, inside a parenthetical, and absent',
    should: 'flag exactly the "(me)" bullets as mine',
    actual: items.map((i) => i.mine),
    expected: [true, true, false, true, false],
  })

  assert({
    given: 'the deterministic fallback parser',
    should: 'never carry dates or times',
    actual: items.every((i) => i.date === null && i.time === null),
    expected: true,
  })
})

test('parseActionItemsSection() - section boundaries', () => {
  assert({
    given: 'a body without an Action Items section',
    should: 'return an empty array',
    actual: parseActionItemsSection('# Title\n\n## Meeting Summary\n\n- Not an action item\n'),
    expected: [],
  })

  assert({
    given: 'an empty Action Items section followed by another section',
    should: 'return an empty array',
    actual: parseActionItemsSection('## Action Items\n\n## Decisions\n\n- Ship it\n'),
    expected: [],
  })

  assert({
    given: 'a lower-case header and a bullet that is only a "(me)" marker',
    should: 'match the header case-insensitively and drop the empty item',
    actual: parseActionItemsSection('## action items\n\n- (me)\n- Draft the summary (me)\n'),
    expected: [{ text: 'Draft the summary', mine: true, date: null, time: null }],
  })
})

test('normalizeActionItems() - valid and invalid entries', () => {
  assert({
    given: 'a well-formed extract payload',
    should: 'pass entries through with the hour zero-padded',
    actual: normalizeActionItems([
      { text: 'Call Jane Doe about the proposal', mine: true, date: '2026-08-28', time: '9:30' },
    ]),
    expected: [{ text: 'Call Jane Doe about the proposal', mine: true, date: '2026-08-28', time: '09:30' }],
  })

  assert({
    given: 'malformed entries: no text, bad date, time without a date, non-boolean mine',
    should: 'drop unusable entries and null out unusable fields',
    actual: normalizeActionItems([
      { mine: true, date: '2026-08-28' },
      { text: 'Review the draft', mine: 'yes', date: 'next Friday' },
      { text: 'Ping the vendor', mine: false, date: null, time: '14:00' },
      'not an object',
    ]),
    expected: [
      { text: 'Review the draft', mine: false, date: null, time: null },
      { text: 'Ping the vendor', mine: false, date: null, time: null },
    ],
  })

  assert({
    given: 'a payload that is not an array',
    should: 'return an empty array',
    actual: normalizeActionItems({ text: 'Not a list' }),
    expected: [],
  })
})
