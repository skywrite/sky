import { assert, test } from '#test'
import { parseDigest } from './sessionDigest.ts'

test('parseDigest accepts a plain JSON reply', () => {
  const digest = parseDigest(
    JSON.stringify({
      title: 'widget work',
      about: 'Built the widget.',
      decided: ['ship it'],
      built: ['widget'],
      open: [],
      learned: [],
    }),
  )

  assert({
    given: 'a valid JSON digest',
    should: 'parse title and arrays',
    expected: 'widget work / ship it',
    actual: `${digest?.title} / ${digest?.decided[0]}`,
  })
})

test('parseDigest strips code fences', () => {
  const digest = parseDigest('```json\n{"title":"widget work","about":"Built the widget."}\n```')

  assert({
    given: 'a fenced JSON reply',
    should: 'still parse, with missing arrays as empty',
    expected: 'Built the widget. / 0',
    actual: `${digest?.about} / ${digest?.decided.length}`,
  })
})

test('parseDigest rejects malformed replies', () => {
  assert({
    given: 'a reply missing the title',
    should: 'return null',
    expected: null,
    actual: parseDigest('{"about":"Built the widget."}'),
  })

  assert({
    given: 'a non-JSON reply',
    should: 'return null',
    expected: null,
    actual: parseDigest('I could not produce a digest.'),
  })
})

test('parseDigest coerces non-string array entries away', () => {
  const digest = parseDigest(
    JSON.stringify({ title: 't', about: 'a', decided: ['keep', 42, '', null], built: 'not-an-array' }),
  )

  assert({
    given: 'arrays with junk entries and a non-array field',
    should: 'keep only non-empty strings',
    expected: 'keep / 0',
    actual: `${digest?.decided.join(',')} / ${digest?.built.length}`,
  })
})
