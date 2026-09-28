import { assert, test } from '#test'
import { shortParagraphs } from './document.ts'

test('a drafted paragraph longer than two sentences breaks into short paragraphs', () => {
  assert({
    given: 'a five-sentence paragraph under a bold section label',
    should: 'break it at sentence ends into paragraphs of at most two sentences',
    actual: shortParagraphs(
      [
        '**Why this matters**',
        "Atlas's scope covers only July and August. The work starts within days. There is no default owner. The agency contract ends July 30 and Jane Doe leaves Aug. 9. The launch needs one accountable person.",
      ].join('\n\n'),
    ),
    expected: [
      '**Why this matters**',
      "Atlas's scope covers only July and August. The work starts within days.",
      'There is no default owner. The agency contract ends July 30 and Jane Doe leaves Aug. 9.',
      'The launch needs one accountable person.',
    ].join('\n\n'),
  })
})

test('short paragraphs, lists, headings, and code keep their exact shape', () => {
  const body = [
    'Send the Atlas handoff to Jane Doe. She reviews it Friday.',
    '## Done when',
    '- The draft names the owner. It sets the cadence. It lists every role.',
    '1. First step. Second sentence. Third sentence.',
    '> A quoted note. With three. Sentences here.',
    '```\nOne. Two. Three. Four.\n\nFive. Six. Seven.\n```',
    'Line one of a hand-wrapped paragraph. Still one.\nLine two. And more.',
  ].join('\n\n')
  assert({
    given: 'a body whose only long prose sits in lists, quotes, code, or hand-wrapped lines',
    should: 'return it unchanged',
    actual: shortParagraphs(body),
    expected: body,
  })
})

test('a sentence break never lands inside a link, a parenthesis, or a code span', () => {
  assert({
    given: 'sentence ends inside link text, parentheses, and inline code',
    should: 'keep each span whole while breaking the paragraph elsewhere',
    actual: shortParagraphs(
      'Start from [the brief. Version two](https://example.com/brief). Then read the notes (see the summary. It is short). Run `make check. Then deploy` once. Send it to Jane Doe.',
    ),
    expected: [
      'Start from [the brief. Version two](https://example.com/brief). Then read the notes (see the summary. It is short).',
      'Run `make check. Then deploy` once. Send it to Jane Doe.',
    ].join('\n\n'),
  })
})
