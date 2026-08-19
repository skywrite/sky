import { assert, test } from '#test'
import { normalizeDigest } from './sessionDigest.ts'

test('normalizeDigest trims title and about', () => {
  const digest = normalizeDigest({
    title: '  widget work ',
    about: ' Built the widget. ',
    decided: ['ship it'],
    built: ['widget'],
    open: [],
    learned: [],
  })

  assert({
    given: 'a digest with padded title and about',
    should: 'trim both and keep arrays',
    expected: 'widget work / Built the widget. / ship it',
    actual: `${digest?.title} / ${digest?.about} / ${digest?.decided[0]}`,
  })
})

test('normalizeDigest rejects a blank title or about', () => {
  const blank = { decided: [], built: [], open: [], learned: [] }

  assert({
    given: 'a digest whose title is whitespace',
    should: 'return null',
    expected: null,
    actual: normalizeDigest({ ...blank, title: '   ', about: 'Built the widget.' }),
  })

  assert({
    given: 'a digest whose about is empty',
    should: 'return null',
    expected: null,
    actual: normalizeDigest({ ...blank, title: 'widget work', about: '' }),
  })
})

test('normalizeDigest drops blank array entries', () => {
  const digest = normalizeDigest({
    title: 't',
    about: 'a',
    decided: ['keep', '', '  '],
    built: [],
    open: [],
    learned: [],
  })

  assert({
    given: 'arrays containing empty and whitespace-only entries',
    should: 'keep only non-blank strings',
    expected: 'keep / 1',
    actual: `${digest?.decided.join(',')} / ${digest?.decided.length}`,
  })
})
