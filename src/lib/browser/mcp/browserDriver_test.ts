import { assert, test } from '#test'
import { firstUrl } from './browserDriver.ts'

test('the first address in a task is where it starts', () => {
  assert({
    given: 'a task naming an address mid-sentence, and one naming none',
    should: 'find the address and only the address',
    actual: [firstUrl('Go to https://www.atlas.example/ , sign in, and download.'), firstUrl('Download my tax forms.')],
    expected: ['https://www.atlas.example/', undefined],
  })
})
