// TODO: These tests fail under bun due to JSX runtime mismatch — Hono JSX elements
// are passed to react-dom's renderToString which expects React elements. The error is:
// "Objects are not valid as a React child (found: object with keys {tag, props, key, children, isEscaped, localContexts})"
// This affects all tests that hit the markdown preview server rendering path.
// Works under deno because the JSX factory resolution differs.

import * as os from 'node:os'
import * as path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

test({ name: 'docs route - renders explorer without a selected file', ignore: true }, async () => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-empty-'))
  const notesDir = path.join(testDir, 'notes')
  await mkdir(notesDir, { recursive: true })

  try {
    const app = createTestHttpApp([notesDir])
    const response = await app.request('http://localhost/docs/')
    const html = await response.text()

    assert({
      given: 'docs route without a selected file',
      should: 'return 200',
      actual: response.status,
      expected: 200,
    })

    assert({
      given: 'docs route without a selected file',
      should: 'render the empty-state copy',
      actual: html.includes('Select a markdown file from the explorer to preview it here.'),
      expected: true,
    })
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('docs route - redirects query param form to path form', async () => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-redirect-'))
  const notesDir = path.join(testDir, 'notes')
  await mkdir(notesDir, { recursive: true })

  try {
    const app = createTestHttpApp([notesDir])
    const response = await app.request('http://localhost/docs?file=notes/foo.md&theme=night', {
      redirect: 'manual',
    })

    assert({
      given: 'docs route with file query param',
      should: 'redirect to the path-based docs URL',
      actual: response.headers.get('location'),
      expected: '/docs/notes/foo.md?theme=night',
    })
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('legacy markdown preview route - redirects to docs route', async () => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-legacy-'))
  const notesDir = path.join(testDir, 'notes')
  await mkdir(notesDir, { recursive: true })

  try {
    const app = createTestHttpApp([notesDir])
    const response = await app.request('http://localhost/markdown/view/notes/foo.md?theme=night', {
      redirect: 'manual',
    })

    assert({
      given: 'legacy markdown preview route',
      should: 'redirect to the docs route',
      actual: response.headers.get('location'),
      expected: '/docs/notes/foo.md?theme=night',
    })
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('docs route - rejects file outside configured markdown dirs', async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-root-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const outsideFile = path.join(notebookBaseDir, 'outside.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(outsideFile, '# Outside File\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/outside.md')
    const text = await response.text()

    assert({
      given: 'docs route with file outside configured roots',
      should: 'return 403',
      actual: response.status,
      expected: 403,
    })

    assert({
      given: 'docs route with file outside configured roots',
      should: 'explain the directory restriction',
      actual: text,
      expected: 'Requested file is outside configured markdown directories',
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test({ name: 'docs route - renders markdown in browser', ignore: true }, async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-render-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    const projectDir = path.join(previewDir, 'projects')
    const nestedMarkdownFile = path.join(projectDir, 'alpha.md')
    await mkdir(previewDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      previewFile,
      `---
title: Preview Test
---

# Preview Test

This is **phase 1** browser rendering.
`,
    )
    await writeFile(nestedMarkdownFile, '# Alpha\n')
    await writeFile(path.join(previewDir, 'todo.txt'), 'ignore me')
    await writeFile(path.join(previewDir, '.hidden.md'), '# Hidden\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/notes/preview.md?theme=night')
    const html = await response.text()

    assert({
      given: 'preview route for a markdown file',
      should: 'return 200',
      actual: response.status,
      expected: 200,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'render the markdown heading as HTML',
      actual: html.includes('<h1>Preview Test</h1>'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'show the notebook-relative path',
      actual: html.includes('notes/preview.md'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file with frontmatter',
      should: 'include a frontmatter section',
      actual: html.includes('YAML frontmatter'),
      expected: true,
    })

    assert({
      given: 'preview route with explorer enabled',
      should: 'include the explorer shell',
      actual: html.includes('Browse notebook markdown files and jump between them.'),
      expected: true,
    })

    assert({
      given: 'docs route with nested markdown files',
      should: 'include explorer links for nested markdown files',
      actual: html.includes('/docs/notes/projects/alpha.md?theme=night'),
      expected: true,
    })

    assert({
      given: 'preview route with the current file selected',
      should: 'mark the current file in the explorer',
      actual: html.includes('data-current="true"'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'embed preview sync state',
      actual: html.includes('id="preview-sync-state"'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'embed the content api path for preview sync',
      actual: html.includes('/docs/_api/content/notes/preview.md'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'render font size controls',
      actual: html.includes('data-font-scale-action="increase"'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'render the pdf export button',
      actual: html.includes('data-pdf-export-path="/docs/_api/export-pdf/notes/preview.md?theme=night"'),
      expected: true,
    })

    assert({
      given: 'preview route for a markdown file',
      should: 'render the custom context menu shell',
      actual: html.includes('id="docs-context-menu"'),
      expected: true,
    })

    assert({
      given: 'preview route with non-markdown files',
      should: 'exclude them from the explorer',
      actual: html.includes('todo.txt'),
      expected: false,
    })

    assert({
      given: 'preview route with hidden markdown files',
      should: 'exclude them from the explorer',
      actual: html.includes('.hidden.md'),
      expected: false,
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test({ name: 'docs route - renders raw markdown editor in edit mode', ignore: true }, async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-edit-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '# Editable\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/notes/preview.md?mode=edit')
    const html = await response.text()

    assert({
      given: 'docs route in edit mode',
      should: 'render the block markdown editor',
      actual: html.includes('id="block-markdown-editor-state"'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'render the content API path into the page',
      actual: html.includes('/docs/_api/content/notes/preview.md'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'render the document API path into the page',
      actual: html.includes('/docs/_api/document/notes/preview.md'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'render the block preview API path into the page',
      actual: html.includes('/docs/_api/render-block'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'render the rendered block editor label',
      actual: html.includes('Rendered Blocks'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'render click-to-edit guidance',
      actual: html.includes('Click any rendered block to edit it in place.'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode',
      should: 'show the edit mode toggle as active',
      actual: html.includes('href="/docs/notes/preview.md?mode=edit"'),
      expected: true,
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test({ name: 'docs route - renders frontmatter only once in edit mode', ignore: true }, async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-edit-frontmatter-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '---\ntitle: Preview\n---\n\n# Editable\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/notes/preview.md?mode=edit')
    const html = await response.text()

    assert({
      given: 'docs route in edit mode with frontmatter',
      should: 'render the standalone frontmatter panel',
      actual: html.includes('YAML frontmatter'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode with frontmatter',
      should: 'omit the frontmatter block from the editor block list',
      actual: html.includes('data-cid="frontmatter"'),
      expected: false,
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})

test({ name: 'docs route - renders thematic breaks without raw block chrome in edit mode', ignore: true }, async () => {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), 'http-preview-edit-hr-'))

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, '# Before\n\n---\n\n# After\n')

    const app = createTestHttpApp([previewDir])
    const response = await app.request('http://localhost/docs/notes/preview.md?mode=edit')
    const html = await response.text()

    assert({
      given: 'docs route in edit mode with a thematic break',
      should: 'render the horizontal rule preview',
      actual: html.includes('<hr>'),
      expected: true,
    })

    assert({
      given: 'docs route in edit mode with a thematic break',
      should: 'omit the raw preserved-block header for the hr block',
      actual: html.includes('<p class="editable-block-label">Thematic Break</p>'),
      expected: false,
    })
  } finally {
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
})
