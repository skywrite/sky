import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'
import { appendCommitments, categoryOf, incompleteTitle, sweepIncomplete } from './moveCommitments.ts'

const SOURCE = `---
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

## Professional Complete
- 09:00 > Standup with the Atlas team

[atlas]: https://example.com/atlas
[deck]: https://example.com/atlas-deck
[mail]: https://example.com/mail
`

const SOURCE_LINK_DEFS = [
  '[atlas]: https://example.com/atlas',
  '[deck]: https://example.com/atlas-deck',
  '[mail]: https://example.com/mail',
]

const SOURCE_TODOS_ALREADY_SWEPT = `# **2026-03-30 - Mon**

## Professional Commitments
- 15:00 > Call [Acme][acme] about the renewal

## Professional Complete
- 09:00 > Standup with the Atlas team

## Professional Incomplete
- Draft the Q2 roadmap

[acme]: https://example.com/acme
`

const TARGET = `# **2026-03-31 - Tue**

## Most Important
- Ship Atlas v1

## Professional Commitments
- 10:00 > Sync with Jane

## Professional Todos
-

## Professional Complete
-
`

const TARGET_ENDED = `# **2026-03-31 - Tue**

## Most Important
- Ship Atlas v1

## Professional Complete
- 09:00 > Standup with the Atlas team
`

const itemsOf = (doc: DayDocument, title: string) => doc.lists.find((l) => l.title === title)?.items
const titlesOf = (doc: DayDocument) => doc.lists.map((l) => l.title)
const defsIn = (doc: DayDocument, defs: string[]) => defs.filter((def) => doc.toMarkdown().includes(def))
const rendersUndefined = (doc: DayDocument) => doc.toMarkdown().includes('undefined')

function sweepOrThrow(doc: DayDocument, title: string, opts?: { cleanOnly?: boolean }) {
  const swept = sweepIncomplete(doc, title, opts)
  if (!swept) throw new Error(`Expected list "${title}"`)
  return swept
}

test('incompleteTitle / categoryOf - derive from the list title', () => {
  assert({
    given: 'a Commitments list title',
    should: 'name the matching Incomplete section',
    actual: incompleteTitle('Personal Commitments'),
    expected: 'Personal Incomplete',
  })
  assert({
    given: 'a Commitments list title',
    should: 'give the bare category',
    actual: categoryOf('Personal Commitments'),
    expected: 'Personal',
  })
})

test('sweepIncomplete - unfinished commitments move to Incomplete, done ones stay', () => {
  const { doc, notDone } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Professional Commitments')

  assert({
    given: 'a Commitments list with one done and two unfinished items',
    should: 'keep only the done item in the list',
    actual: itemsOf(doc, 'Professional Commitments'),
    expected: ['09:00 > ~~Standup with the [Atlas team][atlas]~~'],
  })
  assert({
    given: 'the same sweep',
    should: 'record the unfinished items under Professional Incomplete',
    actual: itemsOf(doc, 'Professional Incomplete'),
    expected: ['08:30 > Inbox zero in [mail][]', '11:00 > Review [the deck][deck] with Jane'],
  })
  assert({
    given: 'the same sweep',
    should: 'hand the unfinished items back for the move',
    actual: notDone.items,
    expected: ['08:30 > Inbox zero in [mail][]', '11:00 > Review [the deck][deck] with Jane'],
  })
  assert({
    given: 'items with [label][] and [text][label] reference links, done and not',
    should: 'keep every link definition in the day',
    actual: defsIn(doc, SOURCE_LINK_DEFS),
    expected: SOURCE_LINK_DEFS,
  })
  assert({
    given: 'the same sweep',
    should: 'never render an undefined link',
    actual: rendersUndefined(doc),
    expected: false,
  })
  assert({
    given: 'the unfinished items handed back',
    should: 'carry their link definitions keyed by label',
    actual: [...notDone.links.keys()].sort(),
    expected: ['deck', 'mail'],
  })
  assert({
    given: 'the same sweep',
    should: 'leave the other lists alone',
    actual: [itemsOf(doc, 'Personal Commitments'), itemsOf(doc, 'Professional Todos')],
    expected: [['18:00 > Gym'], ['Draft the Q2 roadmap']],
  })
})

test('sweepIncomplete - appends to an Incomplete section the todo sweep already made', () => {
  const { doc } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE_TODOS_ALREADY_SWEPT), 'Professional Commitments')

  assert({
    given: 'a day whose todos were already swept into Professional Incomplete',
    should: 'append the commitment after the todos in that section',
    actual: itemsOf(doc, 'Professional Incomplete'),
    expected: ['Draft the Q2 roadmap', '15:00 > Call [Acme][acme] about the renewal'],
  })
  assert({
    given: 'the same day',
    should: 'render exactly one Professional Incomplete heading',
    actual: doc.toMarkdown().match(/^## Professional Incomplete$/gm)?.length,
    expected: 1,
  })
  assert({
    given: 'a [text][label] link on the merged item',
    should: 'keep its definition and render no undefined',
    actual: [defsIn(doc, ['[acme]: https://example.com/acme']), rendersUndefined(doc)],
    expected: [['[acme]: https://example.com/acme'], false],
  })
})

test('sweepIncomplete - cleanOnly drops the unfinished items without a record', () => {
  const { doc, notDone } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Professional Commitments', {
    cleanOnly: true,
  })

  assert({
    given: 'cleanOnly',
    should: 'not create an Incomplete section',
    actual: titlesOf(doc).includes('Professional Incomplete'),
    expected: false,
  })
  assert({
    given: 'cleanOnly',
    should: 'still strip the unfinished items from the list',
    actual: itemsOf(doc, 'Professional Commitments'),
    expected: ['09:00 > ~~Standup with the [Atlas team][atlas]~~'],
  })
  assert({
    given: 'cleanOnly',
    should: 'still hand the unfinished items back',
    actual: notDone.size,
    expected: 2,
  })
})

test('sweepIncomplete - Personal goes to Personal Incomplete', () => {
  const { doc } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Personal Commitments')

  assert({
    given: 'the Personal category',
    should: 'record under Personal Incomplete',
    actual: itemsOf(doc, 'Personal Incomplete'),
    expected: ['18:00 > Gym'],
  })
})

test('sweepIncomplete - nothing unfinished returns the day untouched', () => {
  const day = DayDocument.fromMarkdown(SOURCE_TODOS_ALREADY_SWEPT).replaceList(
    'Professional Commitments',
    DayDocument.fromMarkdown(SOURCE_TODOS_ALREADY_SWEPT)
      .lists[0].filter(() => false)
      .add('15:00 > ~~Call Acme about the renewal~~'),
  )
  const { doc, notDone } = sweepOrThrow(day, 'Professional Commitments')

  assert({
    given: 'a list where everything is done',
    should: 'return the same document instance',
    actual: doc === day,
    expected: true,
  })
  assert({
    given: 'a list where everything is done',
    should: 'report nothing to move',
    actual: notDone.size,
    expected: 0,
  })
})

test('sweepIncomplete - missing list is undefined', () => {
  assert({
    given: 'a day without the requested list',
    should: 'return undefined so the command can report it',
    actual: sweepIncomplete(DayDocument.fromMarkdown(TARGET_ENDED), 'Personal Commitments'),
    expected: undefined,
  })
})

test('appendCommitments - lands in time order on an existing list, links included', () => {
  const { notDone } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Professional Commitments')
  const doc = appendCommitments(DayDocument.fromMarkdown(TARGET), 'Professional Commitments', notDone)

  assert({
    given: 'a target list with a 10:00 item and moved 08:30 and 11:00 items',
    should: 'interleave by time',
    actual: itemsOf(doc, 'Professional Commitments'),
    expected: ['08:30 > Inbox zero in [mail][]', '10:00 > Sync with Jane', '11:00 > Review [the deck][deck] with Jane'],
  })
  assert({
    given: 'moved items with [label][] and [text][label] reference links',
    should: 'carry both link definitions to the target day',
    actual: defsIn(doc, ['[deck]: https://example.com/atlas-deck', '[mail]: https://example.com/mail']),
    expected: ['[deck]: https://example.com/atlas-deck', '[mail]: https://example.com/mail'],
  })
  assert({
    given: 'the target day',
    should: 'never render an undefined link',
    actual: rendersUndefined(doc),
    expected: false,
  })
  assert({
    given: 'an existing list',
    should: 'keep the section order',
    actual: titlesOf(doc),
    expected: ['Most Important', 'Professional Commitments', 'Professional Todos', 'Professional Complete'],
  })
})

test('appendCommitments - creates the list on a day that has none', () => {
  const { notDone } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Professional Commitments')
  const doc = appendCommitments(DayDocument.fromMarkdown(TARGET_ENDED), 'Professional Commitments', notDone)

  assert({
    given: 'a target day whose empty Commitments list was removed at day:end',
    should: 'create the list after Most Important',
    actual: titlesOf(doc),
    expected: ['Most Important', 'Professional Commitments', 'Professional Complete'],
  })
  assert({
    given: 'the created list',
    should: 'hold the moved items',
    actual: itemsOf(doc, 'Professional Commitments'),
    expected: ['08:30 > Inbox zero in [mail][]', '11:00 > Review [the deck][deck] with Jane'],
  })
})

test('appendCommitments - Personal creates Personal Commitments', () => {
  const { notDone } = sweepOrThrow(DayDocument.fromMarkdown(SOURCE), 'Personal Commitments')
  const doc = appendCommitments(DayDocument.fromMarkdown(TARGET), 'Personal Commitments', notDone)

  assert({
    given: 'a target day without a Personal Commitments list',
    should: 'create it with the moved item',
    actual: itemsOf(doc, 'Personal Commitments'),
    expected: ['18:00 > Gym'],
  })
  assert({
    given: 'the created list',
    should: 'sit after Most Important',
    actual: titlesOf(doc).indexOf('Personal Commitments'),
    expected: titlesOf(doc).indexOf('Most Important') + 1,
  })
})
