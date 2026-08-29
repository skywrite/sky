import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { loadDocument, loadLabel } from './loadDocument.ts'

async function tmp(): Promise<string> {
  return makeTempDir({ prefix: 'sky-load-document-' })
}

test('loadDocument - text formats come back as text', async () => {
  const dir = await tmp()
  const file = path.join(dir, 'notes.md')
  await writeFile(file, '# Atlas\n\nLaunch on Tuesday.\n')

  assert({
    given: 'a markdown file',
    should: 'return its text',
    actual: await loadDocument(file),
    expected: { success: true, document: { kind: 'text', text: '# Atlas\n\nLaunch on Tuesday.\n' } },
  })
})

test('loadDocument - a PDF comes back as bytes with its media type', async () => {
  const dir = await tmp()
  const file = path.join(dir, 'brief.pdf')
  const bytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')
  await writeFile(file, bytes)

  const result = await loadDocument(file)
  assert({
    given: 'a .pdf file',
    should: 'return kind pdf, application/pdf, and the raw bytes',
    actual:
      result.success && result.document.kind === 'pdf'
        ? { kind: result.document.kind, mediaType: result.document.mediaType, bytes: [...result.document.data] }
        : result,
    expected: { kind: 'pdf', mediaType: 'application/pdf', bytes: [...bytes] },
  })
})

test('loadDocument - an image comes back as bytes with its media type', async () => {
  const dir = await tmp()
  const file = path.join(dir, 'whiteboard.JPG')
  await writeFile(file, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))

  const result = await loadDocument(file)
  assert({
    given: 'a .JPG file (extension case ignored)',
    should: 'return kind image with image/jpeg',
    actual:
      result.success && result.document.kind === 'image'
        ? { kind: result.document.kind, mediaType: result.document.mediaType, length: result.document.data.length }
        : result,
    expected: { kind: 'image', mediaType: 'image/jpeg', length: 4 },
  })
})

test('loadDocument - an unknown extension reads as text unless it is binary', async () => {
  const dir = await tmp()
  const textish = path.join(dir, 'config.conf')
  await writeFile(textish, 'key = value\n')
  const binary = path.join(dir, 'blob.bin')
  await writeFile(binary, new Uint8Array([0x00, 0x01, 0x02, 0x41, 0x42]))

  assert({
    given: 'an unknown extension holding text',
    should: 'read it as text',
    actual: await loadDocument(textish),
    expected: { success: true, document: { kind: 'text', text: 'key = value\n' } },
  })

  const result = await loadDocument(binary)
  assert({
    given: 'an unknown extension holding NUL bytes',
    should: 'fail, naming the file as binary',
    actual: !result.success && result.error.startsWith('blob.bin is a binary file'),
    expected: true,
  })
})

test('loadDocument - a missing file and an empty file fail with a message', async () => {
  const dir = await tmp()
  const missing = await loadDocument(path.join(dir, 'nope.txt'))
  assert({
    given: 'a path that does not exist',
    should: 'fail with the path in the message',
    actual: !missing.success && missing.error.includes('nope.txt'),
    expected: true,
  })

  const empty = path.join(dir, 'empty.txt')
  await writeFile(empty, '   \n')
  assert({
    given: 'a whitespace-only file',
    should: 'fail as empty',
    actual: await loadDocument(empty),
    expected: { success: false, error: 'File is empty or conversion produced no text' },
  })
})

test('loadLabel - names the read by extension', () => {
  assert({
    given: 'paths of each kind',
    should: 'label the load the way summary:doc reports it',
    actual: ['a.pdf', 'b.png', 'c.docx', 'd.pptx', 'e.xlsx', 'f.md', 'g.conf'].map(loadLabel),
    expected: [
      'Reading PDF',
      'Reading image',
      'Converting .docx via textutil',
      'Converting .pptx via pandoc',
      'Converting .xlsx via SheetJS',
      'Reading MD file',
      'Reading text file',
    ],
  })
})
