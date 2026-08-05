import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test(`TagSet.union()`, () => {
  const given = 'A two sets w/ intersection tags'
  const should = 'return union'

  const tags1 = ['Russian Invasion', 'Family', 'Friends']
  const tags2 = ['Cooking', 'Performance', 'Russian Invasion']
  // order doesn't matter
  const tagsExpected = ['Russian Invasion', 'Family', 'Friends', 'Cooking', 'Performance']
  tagsExpected.sort()

  let tagSet1 = new TagSet()
  let tagSet2 = new TagSet()

  tags1.forEach((tag) => {
    tagSet1 = tagSet1.add(tag)
  })

  tags2.forEach((tag) => {
    tagSet2 = tagSet2.add(tag)
  })

  const tagsUnion1 = tagSet1.union(tagSet2)
  const tagsUnion2 = tagSet2.union(tagSet1)

  const tagsActual = Array.from(tagsUnion1)

  // expected array is sorted
  // this is reversed
  // validates that order doesn't matter
  tagsActual.reverse()

  assert({
    given,
    should,
    expected: true,
    actual: tagsUnion1.equals(tagsUnion2),
  })

  assert({
    given,
    should,
    expected: true,
    actual: tagsActual.every((tag) => tagsExpected.includes(String(tag))),
  })

  tagsActual.sort()

  assert({
    given,
    should,
    expected: true,
    actual: tagsUnion1.toString().includes('; '),
  })
})
