import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test('TagSet::isValidTag() - valid tags', () => {
  const testCases = [
    { tag: 'simple', description: 'simple tag' },
    { tag: 'with-hyphen', description: 'tag with hyphen' },
    { tag: 'with_underscore', description: 'tag with underscore' },
    { tag: 'With Spaces', description: 'tag with spaces' },
    { tag: 'Assets/ETH', description: 'tag with forward slash' },
    { tag: 'namespace:tag', description: 'tag with colon' },
    { tag: 'v1.0.0', description: 'tag with dots' },
    { tag: '123', description: 'numeric tag' },
    { tag: 'Mix123_of-ALL/chars:v1.0', description: 'tag with mixed valid characters' },
    { tag: 'Russian Invasion', description: 'tag with multiple words' },
  ]

  testCases.forEach(({ tag, description }) => {
    assert({
      given: `a ${description}: "${tag}"`,
      should: 'be valid',
      expected: true,
      actual: TagSet.isValidTag(tag),
    })
  })
})

test('TagSet::isValidTag() - invalid tags', () => {
  const testCases = [
    { tag: '', description: 'empty string' },
    { tag: '   ', description: 'only spaces' },
    { tag: 'has;semicolon', description: 'tag with semicolon' },
    { tag: ';', description: 'just semicolon' },
    { tag: 'tag;', description: 'tag ending with semicolon' },
    { tag: ';tag', description: 'tag starting with semicolon' },
  ]

  testCases.forEach(({ tag, description }) => {
    assert({
      given: `an invalid tag (${description}): "${tag}"`,
      should: 'be invalid',
      expected: false,
      actual: TagSet.isValidTag(tag),
    })
  })
})

test('TagSet::isValidTag() - edge cases', () => {
  assert({
    given: 'null',
    should: 'be invalid',
    expected: false,
    actual: TagSet.isValidTag(null as any),
  })

  assert({
    given: 'undefined',
    should: 'be invalid',
    expected: false,
    actual: TagSet.isValidTag(undefined as any),
  })

  assert({
    given: 'a tag that becomes empty after trimming',
    should: 'be invalid',
    expected: false,
    actual: TagSet.isValidTag('\t\n  \r'),
  })
})
