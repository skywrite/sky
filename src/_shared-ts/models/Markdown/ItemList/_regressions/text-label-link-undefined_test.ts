import DayDocument from '#shared/models/Day/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'

/**
 * Regression: a `[text][label]` reference link lost its definition on the way
 * through ItemList.filter/remove. The list's link map was keyed by the link
 * text ("the deck") while filter/remove looked it up by the label ("deck"),
 * so the moved list carried `deck → undefined` and the day it landed on
 * rendered `[deck]: undefined`. Sky writes `[label][]`, where text and label
 * coincide, so only hand-written links hit it.
 */

const SOURCE = `# **2026-03-30 - Mon**

## Professional Todos
- Review [the deck][deck] with Jane
- ~~Send [Jane][jane] the notes~~
- Ask [Sam][nowhere] about the venue

## Professional Complete
-

[deck]: https://example.com/atlas-deck
[jane]: https://example.com/people/jane
`

const TARGET = `# **2026-03-31 - Tue**

## Professional Todos
- Draft the Q2 roadmap

## Professional Complete
-
`

test('ItemList.filter - keeps the definition of a [text][label] link, keyed by label', () => {
  const list = ListDocument.fromMarkdown(SOURCE).lists[0]
  const notDone = list.filter(DayDocument.isItemNotDone)

  assert({
    given: 'a kept item with a [text][label] link',
    should: 'resolve the link under its label',
    actual: notDone.links.get('deck'),
    expected: { label: 'deck', href: 'https://example.com/atlas-deck' },
  })
  assert({
    given: 'a kept item whose label has no definition',
    should: 'add no entry rather than an undefined one',
    actual: [...notDone.links.keys()],
    expected: ['deck'],
  })
})

test('ItemList.remove - hands back the definition of a [text][label] link', () => {
  const list = ListDocument.fromMarkdown(SOURCE).lists[0]
  const { newList, links } = list.remove(0)

  assert({
    given: 'a removed item with a [text][label] link',
    should: 'return its definition under the label',
    actual: links?.get('deck'),
    expected: { label: 'deck', href: 'https://example.com/atlas-deck' },
  })
  assert({
    given: 'the remaining list',
    should: 'no longer hold that definition',
    actual: newList.links.has('deck'),
    expected: false,
  })
})

test('day:todo:move-future path - the target day gets the definition, never undefined', () => {
  const source = DayDocument.fromMarkdown(SOURCE)
  const target = DayDocument.fromMarkdown(TARGET)
  const notDone = source.lists[0].filter(DayDocument.isItemNotDone)

  // The same two steps day:todo:move-future takes on the target day
  const targetTodos = target.lists.find((l) => l.title === 'Professional Todos')
  if (!targetTodos) throw new Error('Expected Professional Todos')
  const moved = target.replaceList('Professional Todos', targetTodos.concat(notDone))
  const markdown = moved.toMarkdown()

  assert({
    given: 'unfinished todos with a [text][label] link moved onto another day',
    should: 'carry the link definition along',
    actual: markdown.includes('[deck]: https://example.com/atlas-deck'),
    expected: true,
  })
  assert({
    given: 'the same move',
    should: 'render no undefined definition, not even for the dangling reference',
    actual: markdown.includes('undefined'),
    expected: false,
  })
})
