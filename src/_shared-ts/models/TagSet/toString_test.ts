import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test(`TagSet.toString()`, () => {
  const given = 'A set with 3 tags'
  const should = 'Convert to strings separated with ;'

  const tags = ['Russian Invasion', 'Family', 'Friends']
  let tagSet = new TagSet()

  tags.forEach((tag) => {
    tagSet = tagSet.add(tag)
  })

  assert({
    given,
    should,
    expected: tags.join('; '),
    actual: tagSet.toString(),
  })
})
