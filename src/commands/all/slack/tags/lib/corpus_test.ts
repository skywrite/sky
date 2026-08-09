import { assert, test } from '#test'
import {
  buildTagMenu,
  channelHistory,
  channelMajoritySet,
  mediumOfBasename,
  recordFromMarkdown,
  sliceBefore,
} from './corpus.ts'
import type { MessageRecord } from './corpus.ts'

test('mediumOfBasename handles both filename generations', () => {
  assert({
    given: 'legacy name',
    should: 'detect slack',
    actual: mediumOfBasename('slack_Jane_Topic.md'),
    expected: 'slack',
  })
  assert({
    given: 'time-prefixed name',
    should: 'detect slack',
    actual: mediumOfBasename('10-15_slack_Jane_Topic.md'),
    expected: 'slack',
  })
  assert({
    given: 'extended-hours prefix',
    should: 'detect slack',
    actual: mediumOfBasename('25-30_slack_Jane_Topic.md'),
    expected: 'slack',
  })
  assert({
    given: 'an email file',
    should: 'detect email',
    actual: mediumOfBasename('email_Jane_Topic.md'),
    expected: 'email',
  })
  assert({
    given: 'a non-message file',
    should: 'return undefined',
    actual: mediumOfBasename('2026-03-17.md'),
    expected: undefined,
  })
})

const DAY_PATH = '/notebook/time/2026/03/16-22/03-17/actions/messages/10-15_slack_Jane-to-atlas_Topic.md'

const FILE = `---
from: Jane Doe
to: '#atlas'
when: 2026-03-17 10:15
medium: Slack
summary: Rollout status
rel:
  - Atlas
tags: Work/Eng; Work/Incident
---

# Rollout status

## 10:15 - **Jane Doe**

Deploy is out.
`

test('recordFromMarkdown extracts frontmatter, tags, and day date', () => {
  const record = recordFromMarkdown(DAY_PATH, FILE, 'slack')
  assert({ given: 'a day-dir path', should: 'derive the date', actual: record.date, expected: '2026-03-17' })
  assert({ given: 'a to field', should: 'use it as channel', actual: record.channel, expected: '#atlas' })
  assert({
    given: 'a tags line',
    should: 'split on semicolons',
    actual: record.tags,
    expected: ['Work/Eng', 'Work/Incident'],
  })
  assert({ given: 'a body', should: 'carry it', actual: record.body.includes('Deploy is out.'), expected: true })
})

test('recordFromMarkdown falls back to from when to is absent', () => {
  const noTo = FILE.replace("to: '#atlas'\n", '')
  const record = recordFromMarkdown(DAY_PATH, noTo, 'slack')
  assert({ given: 'no to field', should: 'use from as channel', actual: record.channel, expected: 'Jane Doe' })
})

function rec(date: string, channel: string, tags: string[]): MessageRecord {
  return { path: `${date}/${channel}`, date, medium: 'slack', channel, tags, body: '' }
}

const RECORDS = [
  rec('2026-01-05', '#atlas', ['Work/Eng']),
  rec('2026-01-06', '#atlas', ['Work/Eng']),
  rec('2026-01-07', '#atlas', ['Work/Eng', 'Work/Incident']),
  rec('2026-01-07', '#music', ['Hobby/Music']),
  rec('2026-01-08', '#music', []),
]

test('sliceBefore excludes same-day records', () => {
  const slice = sliceBefore(RECORDS, '2026-01-07')
  assert({ given: 'a slice date', should: 'keep only earlier days', actual: slice.length, expected: 2 })
})

test('buildTagMenu counts and orders by frequency', () => {
  const menu = buildTagMenu(RECORDS)
  assert({
    given: 'repeated tags',
    should: 'rank the most used first',
    actual: menu[0],
    expected: { tag: 'Work/Eng', count: 3 },
  })
  assert({ given: 'distinct tags', should: 'count them all', actual: menu.length, expected: 3 })
})

test('channelHistory only sees its channel', () => {
  const history = channelHistory(RECORDS, '#music')
  assert({
    given: 'a channel filter',
    should: 'return that channel tags',
    actual: history,
    expected: [{ tag: 'Hobby/Music', count: 1 }],
  })
  assert({ given: 'no channel', should: 'return empty', actual: channelHistory(RECORDS, undefined), expected: [] })
})

test('channelMajoritySet picks the most frequent exact set', () => {
  assert({
    given: 'a dominant set',
    should: 'return it',
    actual: channelMajoritySet(RECORDS, '#atlas'),
    expected: ['Work/Eng'],
  })
  assert({
    given: 'a channel with only untagged files',
    should: 'return empty',
    actual: channelMajoritySet([rec('2026-01-08', '#x', [])], '#x'),
    expected: [],
  })
})
