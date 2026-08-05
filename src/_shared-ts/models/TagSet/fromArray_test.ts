import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test(`TagSet::fromArray()`, () => {
  const given = 'A set with 3 tags'
  const should = 'Convert from an array'

  const tags = ['Russian Invasion', 'Family', 'Friends']
  const tagSet = TagSet.fromArray(tags)

  assert({
    given,
    should,
    expected: 'Russian Invasion; Family; Friends',
    actual: tagSet.toString(),
  })
})
