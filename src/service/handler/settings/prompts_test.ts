import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Hono } from 'hono'
import { PromptCatalog } from '#shared/prompts/catalog.ts'
import type { PromptDocument } from '#shared/prompts/catalogTypes.ts'
import { assert, test } from '#test'
import { createPromptRoutes } from './prompts.ts'

test('prompt HTTP routes: read, preview, save, conflict, restore, validation and new template', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sky-prompt-http-')))
  try {
    const sourceDir = path.join(root, 'source')
    await mkdir(sourceDir)
    await writeFile(path.join(sourceDir, 'draft.prompt.md'), '# Draft\n\n{{user.input}}')
    const catalog = new PromptCatalog({ sourceDir, overrideDir: path.join(root, 'notebook/ai/prompts') })
    const app = new Hono().route('/prompts', createPromptRoutes(catalog))
    const send = (url: string, body: unknown, method = 'POST') =>
      app.request(`/prompts/${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const listing = await app.request('/prompts/list')
    const document = await app.request('/prompts/document?id=draft.prompt.md')
    const doc = (await document.json()) as PromptDocument
    const preview = await send('preview', {
      id: doc.id,
      content: '# Edit\n{{user.input}}',
      values: { 'user.input': 'Atlas' },
    })
    assert({
      given: 'a library and unsaved preview',
      should: 'answer successfully without saving preview edits',
      actual: [listing.status, document.status, preview.status, (await catalog.read(doc.id)).content],
      expected: [200, 200, 200, doc.content],
    })
    const saved = await send('document', { id: doc.id, content: '# Saved', version: doc.version }, 'PUT')
    const next = (await saved.json()) as PromptDocument
    const conflict = await send('document', { id: doc.id, content: '# Stale', version: doc.version }, 'PUT')
    const missingVersion = await send('document', { id: doc.id, content: '# Missing version' }, 'PUT')
    const badPath = await app.request('/prompts/document?id=..%2Fsecret.prompt.md')
    const restored = await send('restore', { id: doc.id, version: next.version })
    const crossOrigin = await app.request('/prompts/document', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: JSON.stringify({ id: doc.id, content: 'Unexpected overwrite', version: next.version }),
    })
    assert({
      given: 'a request from another website',
      should: 'refuse access to local prompt files',
      actual: crossOrigin.status,
      expected: 403,
    })
    const created = await send('new', { name: 'email-template' })
    const duplicate = await send('new', { name: 'email-template' })
    const badName = await send('new', { name: '../outside' })
    assert({
      given: 'writes and invalid requests',
      should: 'save, detect conflicts, restore, and constrain new names',
      actual: [
        saved.status,
        conflict.status,
        missingVersion.status,
        badPath.status,
        restored.status,
        created.status,
        duplicate.status,
        badName.status,
      ],
      expected: [200, 409, 400, 403, 200, 201, 409, 400],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
