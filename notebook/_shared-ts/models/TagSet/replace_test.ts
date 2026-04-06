import { assert, test } from '#test'
import TagSet from '#shared/models/TagSet/mod.ts'

test(`TagSet.replace()`, () => {
  const given = 'A set with 3 strings'
  const should = 'Replace one string'

  const input = ['Apples', 'Bananas', 'Pears']
  const tagSet = TagSet.fromUnknown(input)

  const expected = String(TagSet.fromUnknown(['Apples', 'Cherries', 'Pears']))
  const actual = String(tagSet.replace('Bananas', 'Cherries'))

  assert({ given, should, expected, actual })
})

test(`TagSet.replace()`, () => {
  const given = 'A set with 3 strings'
  const should = 'Replace first string'

  const input = ['Apples', 'Bananas', 'Pears']
  const tagSet = TagSet.fromUnknown(input)

  const expected = String(TagSet.fromUnknown(['Cherries', 'Bananas', 'Pears']))
  const actual = String(tagSet.replace('Apples', 'Cherries'))

  assert({ given, should, expected, actual })
})

test(`TagSet.replace()`, () => {
  const given = 'A set with 3 strings'
  const should = 'Replace last string'

  const input = ['Apples', 'Bananas', 'Pears']
  const tagSet = TagSet.fromUnknown(input)

  const expected = String(TagSet.fromUnknown(['Apples', 'Bananas', 'Cherries']))
  const actual = String(tagSet.replace('Pears', 'Cherries'))

  assert({ given, should, expected, actual })
})

test(`TagSet.replace()`, () => {
  const given = 'A set with 3 strings and wanting to replace that does not exist'
  const should = 'Return itself'

  const input = ['Apples', 'Bananas', 'Pears']
  const tagSet = TagSet.fromUnknown(input)

  const expected = String(TagSet.fromUnknown(['Apples', 'Bananas', 'Pears']))
  const actual = String(tagSet.replace('yyy', 'xxx'))

  assert({ given, should, expected, actual })
})
