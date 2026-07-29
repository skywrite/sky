import { assert, test } from '#test'
import { dedupeIssues, MAX_CONTEXTS } from './dedupeIssues.ts'
import type { DedupableIssue } from './dedupeIssues.ts'

type TestIssue = DedupableIssue & { type: string }

function make(overrides: Partial<TestIssue> & { originalText: string }): TestIssue {
  return {
    type: 'name',
    confidence: 'medium',
    occurrences: 1,
    contexts: [],
    suggestedFix: null,
    options: null,
    ...overrides,
  }
}

test('dedupeIssues() - distinct issues', () => {
  assert({
    given: 'issues with distinct texts',
    should: 'pass through unchanged, order preserved',
    actual: dedupeIssues([make({ originalText: 'Novack' }), make({ originalText: 'Banks' })]).map(
      (i) => i.originalText,
    ),
    expected: ['Novack', 'Banks'],
  })

  assert({
    given: 'no issues',
    should: 'return an empty array',
    actual: dedupeIssues([]),
    expected: [],
  })
})

test('dedupeIssues() - high-confidence groups', () => {
  const collapsed = dedupeIssues([
    make({
      originalText: 'Niles Novack',
      confidence: 'high',
      suggestedFix: 'Nils Novak',
      occurrences: 2,
      contexts: ['met with Niles Novack today'],
    }),
    make({
      originalText: 'niles  novack',
      confidence: 'high',
      suggestedFix: 'Nils Novak',
      contexts: ['call Niles Novack back'],
    }),
  ])
  assert({
    given: 'the same high-confidence fix reported per instance, casing and spacing varying',
    should: 'collapse to one issue, summing occurrences and collecting contexts',
    actual: collapsed.map((i) => ({ text: i.originalText, n: i.occurrences, contexts: i.contexts })),
    expected: [
      {
        text: 'Niles Novack',
        n: 3,
        contexts: ['met with Niles Novack today', 'call Niles Novack back'],
      },
    ],
  })

  assert({
    given: 'high-confidence duplicates whose fixes disagree',
    should: 'keep one entry per distinct fix so each applies by context',
    actual: dedupeIssues([
      make({ originalText: 'there', confidence: 'high', suggestedFix: 'their' }),
      make({ originalText: 'there', confidence: 'high', suggestedFix: "there's" }),
      make({ originalText: 'there', confidence: 'high', suggestedFix: 'their' }),
    ]).map((i) => ({ fix: i.suggestedFix, n: i.occurrences })),
    expected: [
      { fix: 'their', n: 2 },
      { fix: "there's", n: 1 },
    ],
  })
})

test('dedupeIssues() - mixed-confidence groups', () => {
  const merged = dedupeIssues([
    make({ originalText: 'novack', confidence: 'low', suggestedFix: 'Clover' }),
    make({ originalText: 'Novack', confidence: 'high', suggestedFix: 'Novak', options: ['Klover'] }),
    make({ originalText: 'Novack', confidence: 'medium', suggestedFix: 'Novak' }),
  ])
  assert({
    given: 'a group mixing confidences and fixes',
    should: 'merge to one issue at the most cautious confidence, best fix suggested, the rest as options',
    actual: merged.map((i) => ({
      text: i.originalText,
      confidence: i.confidence,
      fix: i.suggestedFix,
      options: i.options,
      n: i.occurrences,
    })),
    expected: [{ text: 'Novack', confidence: 'low', fix: 'Novak', options: ['Klover', 'Clover'], n: 3 }],
  })

  assert({
    given: 'a null fix on the strongest member',
    should: 'fill the suggestion from a dupe without echoing it into options',
    actual: dedupeIssues([
      make({ originalText: 'foo', confidence: 'medium', suggestedFix: null }),
      make({ originalText: 'foo', confidence: 'medium', suggestedFix: 'bar' }),
    ]).map((i) => ({ fix: i.suggestedFix, options: i.options })),
    expected: [{ fix: 'bar', options: null }],
  })

  assert({
    given: 'a deliberate removal (empty-string fix) merged with a worded dupe',
    should: 'keep the removal as the suggestion and never offer empty strings as options',
    actual: dedupeIssues([
      make({ originalText: 'um', confidence: 'medium', suggestedFix: '' }),
      make({ originalText: 'um', confidence: 'low', suggestedFix: 'hmm' }),
      make({ originalText: 'um', confidence: 'low', suggestedFix: '' }),
    ]).map((i) => ({ confidence: i.confidence, fix: i.suggestedFix, options: i.options })),
    expected: [{ confidence: 'low', fix: '', options: ['hmm'] }],
  })
})

test('dedupeIssues() - merge mechanics', () => {
  assert({
    given: `more than ${MAX_CONTEXTS} contexts across duplicates`,
    should: `cap at ${MAX_CONTEXTS} and drop repeats`,
    actual: dedupeIssues([
      make({ originalText: 'x', contexts: ['a', 'b'] }),
      make({ originalText: 'x', confidence: 'low', contexts: ['b', 'c', 'd'] }),
    ])[0].contexts,
    expected: ['a', 'b', 'c'],
  })

  assert({
    given: 'a custom field on the issue type',
    should: 'preserve it through the merge',
    actual: dedupeIssues([
      make({ originalText: 'x', type: 'technical' }),
      make({ originalText: 'x', confidence: 'low' }),
    ])[0].type,
    expected: 'technical',
  })

  const input = [
    make({ originalText: 'x', confidence: 'high', suggestedFix: 'y', occurrences: 1, contexts: ['a'] }),
    make({ originalText: 'x', confidence: 'low', suggestedFix: 'z', occurrences: 1, contexts: ['b'] }),
  ]
  dedupeIssues(input)
  assert({
    given: 'an input array',
    should: 'not mutate its issues',
    actual: input.map((i) => ({ n: i.occurrences, options: i.options, contexts: i.contexts })),
    expected: [
      { n: 1, options: null, contexts: ['a'] },
      { n: 1, options: null, contexts: ['b'] },
    ],
  })
})
