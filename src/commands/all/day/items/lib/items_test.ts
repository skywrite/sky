import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { cleanItemText, findDayItem, listDayItems, normalizeForMatch, parseListKind } from './items.ts'

const DAY = `---
started: 08:00
tz: America/Chicago
---

# **2026-03-30 - Mon**

## Most Important
- Ship Atlas v1

## Professional Commitments
- 08:30 > Inbox zero in [mail][]
- 09:00 > ~~Standup with the [Atlas team][atlas]~~
- 11:00 > Review [the deck][deck] with Jane

## Personal Commitments
- 18:00 > Gym

## Professional Todos
- Draft the Q2 roadmap
- Review the Atlas deck notes

## Reminders
- Water the plants

## Professional Complete
- 09:00 > Standup with the Atlas team

[atlas]: https://example.com/atlas
[deck]: https://example.com/atlas-deck
[mail]: https://example.com/mail
`

const day = () => DayDocument.fromMarkdown(DAY)

test('parseListKind - loose names resolve, junk does not', () => {
  assert({
    given: 'singular and cased variants',
    should: 'resolve to the canonical kind',
    actual: [parseListKind('todo'), parseListKind('Commitments'), parseListKind(' reminder ')],
    expected: ['todos', 'commitments', 'reminders'],
  })
  assert({
    given: 'a name that is no list',
    should: 'resolve to nothing',
    actual: parseListKind('groceries'),
    expected: undefined,
  })
})

test('cleanItemText - strike marks off, links to labels, time kept', () => {
  assert({
    given: 'a struck item with a reference link',
    should: 'read as plain text with its time',
    actual: cleanItemText('~~09:00 > Standup with the [Atlas team][atlas]~~'),
    expected: '09:00 > Standup with the Atlas team',
  })
  assert({
    given: 'an inline link',
    should: 'flatten to its label',
    actual: cleanItemText('Read [the doc](https://example.com)'),
    expected: 'Read the doc',
  })
})

test('normalizeForMatch - time prefix and case fold away', () => {
  assert({
    given: 'a timed commitment',
    should: 'match by its words alone',
    actual: normalizeForMatch('08:30 > Inbox zero in [mail][]'),
    expected: 'inbox zero in mail',
  })
})

test('listDayItems - every list, cleaned, with done flags', () => {
  const lists = listDayItems(day())
  assert({
    given: 'the day',
    should: 'list every section in order',
    actual: lists.map((l) => l.title),
    expected: [
      'Most Important',
      'Professional Commitments',
      'Personal Commitments',
      'Professional Todos',
      'Reminders',
      'Professional Complete',
    ],
  })
  const commitments = lists[1].items
  assert({
    given: 'a struck commitment',
    should: 'read clean and count as done',
    actual: commitments[1],
    expected: { text: '09:00 > Standup with the Atlas team', done: true },
  })
})

test('findDayItem - one, many, filtered, already done, none', () => {
  assert({
    given: 'words naming one pending item',
    should: 'find exactly it',
    actual: findDayItem(day(), 'inbox zero').kind,
    expected: 'one',
  })
  const many = findDayItem(day(), 'review')
  assert({
    given: 'words matching several pending items',
    should: 'report all of them',
    actual: many.kind === 'many' ? many.matches.map((m) => m.listTitle) : [],
    expected: ['Professional Commitments', 'Professional Todos'],
  })
  const filtered = findDayItem(day(), 'review', 'todos')
  assert({
    given: 'the same words restricted to todos',
    should: 'resolve to the one todo',
    actual: filtered.kind === 'one' ? filtered.match.raw : filtered.kind,
    expected: 'Review the Atlas deck notes',
  })
  assert({
    given: 'words naming only a struck item',
    should: 'report it already done',
    actual: findDayItem(day(), 'standup').kind,
    expected: 'already-done',
  })
  assert({
    given: 'words naming nothing',
    should: 'find nothing',
    actual: findDayItem(day(), 'quantum kayak').kind,
    expected: 'none',
  })
})
