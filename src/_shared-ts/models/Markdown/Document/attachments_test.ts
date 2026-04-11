import { assert, test } from '#test'
import Document from './mod.ts'

const fixtures = [
  {
    description: 'undefined attachments returns empty array',
    yaml: { title: 'Test' },
    expectedLength: 0,
    expected: [],
  },
  {
    description: 'null attachments returns empty array',
    yaml: { title: 'Test', attachments: null },
    expectedLength: 0,
    expected: [],
  },
  {
    description: 'empty array returns empty array',
    yaml: { title: 'Test', attachments: [] },
    expectedLength: 0,
    expected: [],
  },
  {
    description: 'single attachment without rel',
    yaml: {
      title: 'Test',
      attachments: [{ file: 'photo.jpeg' }],
    },
    expectedLength: 1,
    expected: [{ file: 'photo.jpeg' }],
  },
  {
    description: 'single attachment with rel',
    yaml: {
      title: 'Test',
      attachments: [{ file: 'photo.jpeg', rel: 'Alice, Bob' }],
    },
    expectedLength: 1,
    expected: [{ file: 'photo.jpeg', rel: ['Alice', 'Bob'] }],
  },
  {
    description: 'multiple attachments',
    yaml: {
      title: 'Test',
      attachments: [
        { file: 'photo.jpeg', rel: 'Scarlett, JP, Jolie' },
        { file: 'video.mp4' },
        { file: 'document.pdf' },
      ],
    },
    expectedLength: 3,
    expected: [
      { file: 'photo.jpeg', rel: ['Scarlett', 'JP', 'Jolie'] },
      { file: 'video.mp4' },
      { file: 'document.pdf' },
    ],
  },
  {
    description: 'filters out entries with null file',
    yaml: {
      title: 'Test',
      attachments: [{ file: null }, { file: 'real.jpeg' }],
    },
    expectedLength: 1,
    expected: [{ file: 'real.jpeg' }],
  },
]

fixtures.forEach((fixture) => {
  test(`Document.attachments - ${fixture.description}`, () => {
    const doc = new Document(fixture.yaml as Record<string, unknown>, '# Test')

    assert({
      given: fixture.description,
      should: `have length ${fixture.expectedLength}`,
      actual: doc.attachments.length,
      expected: fixture.expectedLength,
    })

    assert({
      given: fixture.description,
      should: 'return correct attachments',
      actual: doc.attachments,
      expected: fixture.expected,
    })
  })
})
