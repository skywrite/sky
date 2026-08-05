import { assert, test } from '#test'
import type { Attachment } from './attachment.ts'
import Document from './mod.ts'

const fixtures = [
  {
    description: 'set attachments on document with none',
    initial: { title: 'Test' },
    setAttachments: [{ file: 'photo.jpeg' }] as Attachment[],
    expectedLength: 1,
    expectedFiles: ['photo.jpeg'],
  },
  {
    description: 'replace existing attachments',
    initial: { title: 'Test', attachments: [{ file: 'old.jpeg' }] },
    setAttachments: [{ file: 'new.jpeg' }, { file: 'other.pdf' }] as Attachment[],
    expectedLength: 2,
    expectedFiles: ['new.jpeg', 'other.pdf'],
  },
  {
    description: 'clear attachments with empty array',
    initial: { title: 'Test', attachments: [{ file: 'photo.jpeg' }] },
    setAttachments: [] as Attachment[],
    expectedLength: 0,
    expectedFiles: [],
  },
]

fixtures.forEach((fixture) => {
  test(`Document.setAttachments - ${fixture.description}`, () => {
    const doc = new Document(fixture.initial as Record<string, unknown>, '# Test')
    const updated = doc.setAttachments(fixture.setAttachments)

    assert({
      given: fixture.description,
      should: `have length ${fixture.expectedLength}`,
      actual: updated.attachments.length,
      expected: fixture.expectedLength,
    })

    assert({
      given: fixture.description,
      should: 'have correct files',
      actual: updated.attachments.map((a) => a.file),
      expected: fixture.expectedFiles,
    })
  })
})

test('Document.setAttachments - stores correct yaml format', () => {
  const doc = new Document({ title: 'Test' }, '# Test')
  const updated = doc.setAttachments([{ file: 'photo.jpeg', rel: ['Alice', 'Bob'] }, { file: 'video.mp4' }])

  const yamlAttachments = updated.yaml['attachments'] as Record<string, unknown>[]

  assert({
    given: 'attachments with rel',
    should: 'store rel as comma-separated string in yaml',
    actual: yamlAttachments[0].rel,
    expected: 'Alice, Bob',
  })

  assert({
    given: 'attachment without rel',
    should: 'not include rel key',
    actual: yamlAttachments[1].rel,
    expected: undefined,
  })
})

test('Document.setAttachments - empty array sets yaml to undefined', () => {
  const doc = new Document({ title: 'Test', attachments: [{ file: 'photo.jpeg' }] }, '# Test')
  const updated = doc.setAttachments([])

  assert({
    given: 'document with empty attachments set',
    should: 'set yaml attachments to undefined',
    actual: updated.yaml['attachments'],
    expected: undefined,
  })
})

test('Document.addAttachment - appends to existing', () => {
  const doc = new Document({ title: 'Test', attachments: [{ file: 'first.jpeg' }] }, '# Test')
  const updated = doc.addAttachment({ file: 'second.pdf' })

  assert({
    given: 'document with one attachment, adding another',
    should: 'have two attachments',
    actual: updated.attachments.length,
    expected: 2,
  })

  assert({
    given: 'document with one attachment, adding another',
    should: 'have correct files in order',
    actual: updated.attachments.map((a) => a.file),
    expected: ['first.jpeg', 'second.pdf'],
  })
})

test('Document.addAttachment - adds to empty', () => {
  const doc = new Document({ title: 'Test' }, '# Test')
  const updated = doc.addAttachment({ file: 'photo.jpeg', rel: ['Alice'] })

  assert({
    given: 'document with no attachments, adding one',
    should: 'have one attachment',
    actual: updated.attachments.length,
    expected: 1,
  })

  assert({
    given: 'document with no attachments, adding one with rel',
    should: 'preserve rel',
    actual: updated.attachments[0].rel,
    expected: ['Alice'],
  })
})

test('Document.setAttachments - does not modify original', () => {
  const doc = new Document({ title: 'Test', attachments: [{ file: 'original.jpeg' }] }, '# Test')
  doc.setAttachments([{ file: 'new.jpeg' }])

  assert({
    given: 'original document after setAttachments',
    should: 'still have original attachment',
    actual: doc.attachments.map((a) => a.file),
    expected: ['original.jpeg'],
  })
})
