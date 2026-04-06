import { assert, test } from '#test'
import TagSet from '#shared/models/TagSet/mod.ts'

test(`TagSet::fromString()`, () => {
  const given = 'A string with 3 tags'
  const should = 'Convert from the string'

  const tagString = 'Russian Invasion; Family; Friends'
  const tagSet = TagSet.fromString(tagString)

  assert({
    given,
    should,
    expected: 'Russian Invasion; Family; Friends',
    actual: tagSet.toString(),
  })
})

test(`TagSet::fromString() - with unnecessary semicolon`, () => {
  const given = 'A string with 3 tags'
  const should = 'Convert from the string'

  const tagString = 'Russian Invasion; Family; Friends;'
  const tagSet = TagSet.fromString(tagString)

  assert({
    given,
    should,
    expected: 'Russian Invasion; Family; Friends',
    actual: tagSet.toString(),
  })
})
