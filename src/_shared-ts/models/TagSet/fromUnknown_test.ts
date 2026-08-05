import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test(`TagSet::fromUnknown()`, () => {
  const given = 'A string with 3 tags'
  const should = 'Convert from the string'

  const input = 'Russian Invasion; Family; Friends'
  const tagSet = TagSet.fromUnknown(input)

  const expected = 'Russian Invasion; Family; Friends'
  const actual = tagSet.toString()

  assert({ given, should, expected, actual })
})

test(`TagSet::fromUnknown()`, () => {
  const given = 'A string with 3 tags'
  const should = 'Convert from the string with extra semicolon'

  const input = 'Russian Invasion; Family; Friends;'
  const tagSet = TagSet.fromUnknown(input)

  const expected = 'Russian Invasion; Family; Friends'
  const actual = tagSet.toString()

  assert({ given, should, expected, actual })
})

test(`TagSet::fromUnknown()`, () => {
  const given = 'A string with 3 tags'
  const should = 'Convert from an array'

  const input = ['Russian Invasion', 'Family', 'Friends']
  const tagSet = TagSet.fromUnknown(input)

  const expected = 'Russian Invasion; Family; Friends'
  const actual = tagSet.toString()

  assert({ given, should, expected, actual })
})

test(`TagSet::fromUnknown()`, () => {
  const given = 'undefined'
  const should = 'Return empty TagSet'

  const input = undefined
  const tagSet = TagSet.fromUnknown(input)

  const expected = ''
  const actual = tagSet.toString()

  assert({ given, should, expected, actual })
})

test(`TagSet::fromUnknown()`, () => {
  const given = 'null'
  const should = 'Return empty TagSet'

  const input = null
  const tagSet = TagSet.fromUnknown(input)

  const expected = ''
  const actual = tagSet.toString()

  assert({ given, should, expected, actual })
})
