import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

test('docs export pdf api - returns 404 when the markdown file is missing', async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-api-export-missing-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    await mkdir(previewDir, { recursive: true })

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/_api/export-pdf/notes/missing.md', {
      method: 'POST',
    })
    const payload = await response.json()

    assert({
      given: 'docs export pdf api for a missing markdown file',
      should: 'return 404',
      actual: response.status,
      expected: 404,
    })

    assert({
      given: 'docs export pdf api for a missing markdown file',
      should: 'return a useful error message',
      actual: payload.message,
      expected: 'Markdown file not found',
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test('docs content api - reads markdown content and metadata', async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-api-read-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '# Editable\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/_api/content/notes/preview.md')
    const payload = await response.json()

    assert({
      given: 'docs content api',
      should: 'return 200 for a valid markdown file',
      actual: response.status,
      expected: 200,
    })

    assert({
      given: 'docs content api',
      should: 'return the markdown content',
      actual: payload.content,
      expected: '# Editable\n',
    })

    assert({
      given: 'docs content api',
      should: 'return a numeric version',
      actual: typeof payload.version,
      expected: 'number',
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test('docs content api - saves markdown content', async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-api-save-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '# Original\n')

    const app = createTestHttpApp([previewDir])
    const readResponse = await app.request('http://localhost/docs/_api/content/notes/preview.md')
    const snapshot = await readResponse.json()

    const writeResponse = await app.request('http://localhost/docs/_api/content/notes/preview.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '# Updated\n',
        version: snapshot.version,
      }),
    })
    const payload = await writeResponse.json()
    const diskContents = await readFile(previewFile, 'utf-8')

    assert({
      given: 'docs content api save',
      should: 'return 200',
      actual: writeResponse.status,
      expected: 200,
    })

    assert({
      given: 'docs content api save',
      should: 'write the new content to disk',
      actual: diskContents,
      expected: '# Updated\n',
    })

    assert({
      given: 'docs content api save',
      should: 'return a new version',
      actual: typeof payload.version,
      expected: 'number',
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test('docs content api - rejects stale save with conflict payload', async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-api-conflict-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '# Original\n')

    const app = createTestHttpApp([previewDir])
    const readResponse = await app.request('http://localhost/docs/_api/content/notes/preview.md')
    const snapshot = await readResponse.json()

    await writeFile(previewFile, '# Changed elsewhere\n')

    const writeResponse = await app.request('http://localhost/docs/_api/content/notes/preview.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '# My local edit\n',
        version: snapshot.version,
      }),
    })
    const payload = await writeResponse.json()

    assert({
      given: 'docs content api save with stale version',
      should: 'return 409 conflict',
      actual: writeResponse.status,
      expected: 409,
    })

    assert({
      given: 'docs content api save with stale version',
      should: 'return the remote disk contents',
      actual: payload.content,
      expected: '# Changed elsewhere\n',
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})
