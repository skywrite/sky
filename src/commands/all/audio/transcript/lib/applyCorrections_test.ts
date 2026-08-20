import { assert, test } from '#test'
import { applyCorrections } from './applyCorrections.ts'
import type { CorrectionInput } from './applyCorrections.ts'

function make(originalText: string, correction: string, occurrences = 1): CorrectionInput {
  return { originalText, correction, occurrences }
}

test('applyCorrections() - exact replacement', () => {
  const result = applyCorrections('Novack called. Novack agreed.', [make('Novack', 'Banks', 2)])

  assert({
    given: 'a correction matching twice',
    should: 'replace every occurrence',
    actual: result.text,
    expected: 'Banks called. Banks agreed.',
  })

  assert({
    given: 'a correction matching twice',
    should: 'count both replacements',
    actual: { replaced: result.applied[0].replaced, total: result.totalReplacements },
    expected: { replaced: 2, total: 2 },
  })
})

test('applyCorrections() - word boundaries', () => {
  assert({
    given: 'a needle that also appears inside a longer word',
    should: 'replace only the whole-word instance',
    actual: applyCorrections('We gonna ship gonnabe soon.', [make('gonna', 'going to')]).text,
    expected: 'We going to ship gonnabe soon.',
  })

  assert({
    given: 'a needle under three characters',
    should: 'refuse it as too promiscuous to replace blind',
    actual: applyCorrections('Well um the umbrella helps.', [make('um', '')]).dropped[0].reason,
    expected: 'too-short',
  })

  assert({
    given: 'a three-letter filler removal',
    should: 'remove the word and its trailing space, leaving longer words alone',
    actual: applyCorrections('Well uhh the uhhuh stays.', [make('uhh', '')]).text,
    expected: 'Well the uhhuh stays.',
  })
})

test('applyCorrections() - case handling', () => {
  const result = applyCorrections('atlus shipped. Atlus won.', [make('Atlus', 'Atlas', 2)])

  assert({
    given: 'occurrences differing from the needle in case',
    should: 'replace all of them with the canonical spelling',
    actual: result.text,
    expected: 'Atlas shipped. Atlas won.',
  })

  const noInflation = applyCorrections('Atlas and atlas met.', [make('atlas', 'Atlas', 1)])

  assert({
    given: 'an instance already spelled as the correction',
    should: 'leave it alone and not count it',
    actual: { text: noInflation.text, replaced: noInflation.applied[0].replaced },
    expected: { text: 'Atlas and Atlas met.', replaced: 1 },
  })
})

test('applyCorrections() - whitespace flexibility', () => {
  assert({
    given: 'a multi-word needle split by extra spaces in the transcript',
    should: 'still match and replace',
    actual: applyCorrections('The Atlas  Pay launch date.', [make('Atlas Pay', 'AtlasPay')]).text,
    expected: 'The AtlasPay launch date.',
  })

  assert({
    given: 'a needle whose words sit in different speaker turns',
    should: 'not fuse the turns — report the correction as not found',
    actual: applyCorrections('Jane: about Atlas\n\nBanks: Pay is live', [make('Atlas Pay', 'AtlasPay')]).dropped[0]
      .reason,
    expected: 'not-found',
  })
})

test('applyCorrections() - regex special characters', () => {
  assert({
    given: 'a needle containing regex metacharacters',
    should: 'match it literally',
    actual: applyCorrections('We use node.js (beta) here.', [make('node.js (beta)', 'Node.js')]).text,
    expected: 'We use Node.js here.',
  })
})

test('applyCorrections() - longest needle first', () => {
  const result = applyCorrections('Jane Doe spoke. Doe nodded.', [make('Doe', 'Roe'), make('Jane Doe', 'Jan Doh')])

  assert({
    given: 'a short needle contained in a longer one, listed first',
    should: 'apply the longer phrase before the short term can eat it',
    actual: result.text,
    expected: 'Jan Doh spoke. Roe nodded.',
  })
})

test('applyCorrections() - conflicting fixes for one term', () => {
  const result = applyCorrections('Quorvia is here.', [make('Quorvia', 'Corvia'), make('quorvia', 'QRV')])

  assert({
    given: 'two divergent fixes for the same term',
    should: 'apply the first and drop the second as a conflict',
    actual: { text: result.text, reason: result.dropped[0].reason },
    expected: { text: 'Corvia is here.', reason: 'conflict' },
  })
})

test('applyCorrections() - duplicate entries with the same fix', () => {
  const result = applyCorrections('Novack and novack.', [make('Novack', 'Banks', 1), make('novack', 'Banks', 2)])

  assert({
    given: 'two entries for one term with an identical fix',
    should: 'merge into one applied entry with summed expectations',
    actual: {
      entries: result.applied.length,
      occurrences: result.applied[0].occurrences,
      replaced: result.applied[0].replaced,
    },
    expected: { entries: 1, occurrences: 3, replaced: 2 },
  })
})

test('applyCorrections() - spelling confirmed as-is', () => {
  const result = applyCorrections('Banks here. Banks there.', [make('Banks', 'Banks', 2)])

  assert({
    given: 'a correction identical to its needle',
    should: 'change nothing and report the instances it confirmed',
    actual: { text: result.text, replaced: result.applied[0].replaced, total: result.totalReplacements },
    expected: { text: 'Banks here. Banks there.', replaced: 2, total: 0 },
  })
})

test('applyCorrections() - unmatched and empty input', () => {
  const missed = applyCorrections('Nothing relevant here.', [make('flying purple', 'grounded')])

  assert({
    given: 'a needle absent from the transcript',
    should: 'drop it as not found and leave the text unchanged',
    actual: { text: missed.text, reason: missed.dropped[0].reason },
    expected: { text: 'Nothing relevant here.', reason: 'not-found' },
  })

  assert({
    given: 'no corrections at all',
    should: 'return the text untouched with empty buckets',
    actual: applyCorrections('As is.', []),
    expected: { text: 'As is.', applied: [], dropped: [], totalReplacements: 0 },
  })
})
