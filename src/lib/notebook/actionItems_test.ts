import { assert, test } from '#test'
import { normalizeActionItems, parseActionItemsSection } from './actionItems.ts'

const BODY = `# Renewal Terms for the Atlas Account

## Time/Date

2026-08-19 10:00

## Attendees

Jane Doe, Alex Chen

## Meeting Summary

Discussed renewal terms and the rollout timeline.

## Action Items (me)

- Send the revised Atlas proposal to Jane Doe by Friday
* Review the Q3 pricing draft (by end of month)
- Prepare the onboarding checklist
  covering the first two weeks

## Action Items (others)

- Alex Chen: schedule the vendor call
- Confirm the rollout date with the platform team

## Important Questions

- Jane Doe asked who owns the rollout comms.
`

test('parseActionItemsSection() - split sections', () => {
  const items = parseActionItemsSection(BODY)

  assert({
    given: 'a summary body with Action Items (me) and Action Items (others) sections',
    should: 'return one item per bullet, in document order, continuation folded in',
    actual: items.map((i) => i.text),
    expected: [
      'Send the revised Atlas proposal to Jane Doe by Friday',
      'Review the Q3 pricing draft (by end of month)',
      'Prepare the onboarding checklist covering the first two weeks',
      'Alex Chen: schedule the vendor call',
      'Confirm the rollout date with the platform team',
    ],
  })

  assert({
    given: 'the two sections',
    should: 'flag exactly the Action Items (me) bullets as mine',
    actual: items.map((i) => i.mine),
    expected: [true, true, true, false, false],
  })

  assert({
    given: 'the deterministic fallback parser',
    should: 'never carry dates or times',
    actual: items.every((i) => i.date === null && i.time === null),
    expected: true,
  })
})

test('parseActionItemsSection() - legacy single section', () => {
  const items = parseActionItemsSection(
    '## Action Items\n\n' +
      '- Send the revised Atlas proposal to Jane Doe by Friday (me)\n' +
      '- (me) Review the Q3 pricing draft\n' +
      '- Alex Chen: schedule the vendor call\n' +
      '* Confirm the rollout date with the platform team (me, by end of month)\n' +
      '- Prepare the onboarding checklist\n',
  )

  assert({
    given: 'a legacy Action Items section with "(me)" trailing, leading, inside a parenthetical, and absent',
    should: 'flag exactly the "(me)" bullets as mine',
    actual: items.map((i) => i.mine),
    expected: [true, true, false, true, false],
  })

  assert({
    given: 'legacy bullets carrying "(me)" markers',
    should: 'strip the marker from the text',
    actual: items.map((i) => i.text),
    expected: [
      'Send the revised Atlas proposal to Jane Doe by Friday',
      'Review the Q3 pricing draft',
      'Alex Chen: schedule the vendor call',
      'Confirm the rollout date with the platform team (by end of month)',
      'Prepare the onboarding checklist',
    ],
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
    given: 'an empty Action Items (me) section followed by another section',
    should: 'return an empty array',
    actual: parseActionItemsSection('## Action Items (me)\n\n## Decisions\n\n- Ship it\n'),
    expected: [],
  })

  assert({
    given: 'a lower-case header and a bullet that is only a "(me)" marker',
    should: 'match the header case-insensitively and drop the empty item',
    actual: parseActionItemsSection('## action items\n\n- (me)\n- Draft the summary (me)\n'),
    expected: [{ text: 'Draft the summary', mine: true, date: null, time: null }],
  })

  assert({
    given: 'a stray "(me)" marker on a bullet in the others section',
    should: 'honor the marker as a claim of ownership',
    actual: parseActionItemsSection('## Action Items (others)\n\n- Draft the summary (me)\n- Ping the vendor\n'),
    expected: [
      { text: 'Draft the summary', mine: true, date: null, time: null },
      { text: 'Ping the vendor', mine: false, date: null, time: null },
    ],
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
