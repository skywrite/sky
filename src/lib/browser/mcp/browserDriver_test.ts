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

test('sentence punctuation is not part of the starting address', () => {
  assert({
    given: 'addresses ending a sentence, wrapped in code, or carrying a query',
    should: 'remove prose delimiters without changing the URL path or query',
    actual: [
      firstUrl('Open https://www.atlas.example. Then sign in.'),
      firstUrl('Open https://www.atlas.example/documents, then download.'),
      firstUrl('Open `https://www.atlas.example/documents` now.'),
      firstUrl('Open https://www.atlas.example/documents?year=2025&format=pdf.'),
      firstUrl('Open https://www.atlas.example/statement.pdf'),
    ],
    expected: [
      'https://www.atlas.example',
      'https://www.atlas.example/documents',
      'https://www.atlas.example/documents',
      'https://www.atlas.example/documents?year=2025&format=pdf',
      'https://www.atlas.example/statement.pdf',
    ],
  })
})
