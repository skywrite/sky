import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'

const NOW = '2025-03-15 12:00'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-files-'))
  const notebook = path.join(root, 'notebook')
  const state = path.join(root, 'state')
  const content = path.join(state, 'content')
  const media = path.join(root, 'media')
  await mkdir(path.join(notebook, 'time'), { recursive: true })
  const store = new WorkstreamStore(path.join(content, 'workstreams'), state, notebook, undefined, content)
  const work = await store.create({ id: 'atlas', title: 'Atlas pilot', notes: 'Original pilot notes.' }, NOW)
  const app = createTestHttpApp([path.join(notebook, 'time')], {
    userDataDir: media,
    workstreams: {
      store,
      draft: async () => {
        throw new Error('No model calls in this fixture.')
      },
      run: async () => {
        throw new Error('No runs in this fixture.')
      },
      setup: async () => ({}),
      automation: async () => null,
      planDay: async () => work,
    },
  })
  return {
    root,
    notebook,
    state,
    content,
    media,
    store,
    work,
    app,
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('workstream document URLs read, edit and version-check state content while notebook URLs keep their owner', async () => {
  const f = await fixture()
  try {
    await writeFile(path.join(f.notebook, 'time', 'notes.md'), 'Notebook context stays here.')
    const document = await f.app.request(`/explorer/_api/doc?path=${encodeURIComponent(f.work.path)}`)
    const rendered = await document.json()
    const contentUrl = `/docs/_api/content/${f.work.path}`
    const original = await (await f.app.request(contentUrl)).json()
    const text = original.content.replace('Original pilot notes.', 'Updated pilot notes.')
    const save = await f.app.request(contentUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, version: original.version }),
    })
    const conflict = await f.app.request(contentUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: original.content, version: original.version }),
    })
    const listing = await (await f.app.request('/explorer/_api/dir?path=workstreams/atlas')).json()
    const source = await (await f.app.request('/docs/_api/content/time/notes.md')).json()
    assert({
      given: 'canonical work lives outside the notebook under its stable logical path',
      should:
        'render, edit, reject stale saves and retain ordinary notebook reads without recreating notebook workstreams',
      actual: [
        document.status,
        rendered.path,
        rendered.html.includes('Original pilot notes.'),
        save.status,
        conflict.status,
        (await conflict.json()).content,
        (await f.store.get(f.work.id))?.notes,
        listing.entries.some((entry: { path: string }) => entry.path === f.work.path),
        source.content,
        await stat(path.join(f.notebook, 'workstreams')).then(
          () => true,
          () => false,
        ),
      ],
      expected: [
        200,
        f.work.path,
        true,
        200,
        409,
        text,
        'Updated pilot notes.',
        true,
        'Notebook context stays here.',
        false,
      ],
    })
    assert({
      given: 'a logical workstream document save',
      should: 'update only the state-owned Markdown bytes',
      actual: await readFile(path.join(f.content, f.work.path), 'utf8'),
      expected: text,
    })
  } finally {
    await f.clean()
  }
})

test('workstream file routes expose owned attachments but refuse state metadata, hidden files and symlink escapes', async () => {
  const f = await fixture()
  try {
    await writeFile(path.join(f.state, 'permissions.md'), 'Private permission state.')
    await writeFile(path.join(f.store.dir, 'atlas', 'notes.txt'), 'Owned attachment.')
    await writeFile(path.join(f.store.dir, '.hidden.md'), 'Hidden internal receipt.')
    await symlink(f.state, path.join(f.store.dir, 'escape'))
    const owned = await f.app.request('/docs/_api/file/workstreams/atlas/notes.txt')
    const traversal = await f.app.request('/explorer/_api/doc?path=workstreams%2F..%2F..%2Fpermissions.md')
    const hidden = await f.app.request('/docs/_api/content/workstreams/.hidden.md')
    const escaped = await f.app.request('/docs/_api/content/workstreams/escape/permissions.md')
    const unrelatedState = await f.app.request('/docs/_api/content/state/permissions.md')
    assert({
      given: 'attachment, traversal, hidden receipt and symlink requests through the preserved document URLs',
      should: 'serve only owned public content paths and leave state permissions outside the document API',
      actual: [
        owned.status,
        await owned.text(),
        traversal.status,
        hidden.status,
        escaped.status,
        unrelatedState.status,
      ],
      expected: [200, 'Owned attachment.', 403, 403, 400, 403],
    })
  } finally {
    await f.clean()
  }
})

test('new workstream attachments stay beside state content and older media links still open', async () => {
  const f = await fixture()
  try {
    const folder = path.join(f.media, 'workstreams', 'atlas')
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'older.txt'), 'Earlier attachment.')
    const saved = await f.app.request(`/docs/_api/attach/${f.work.path}?name=scope.txt`, {
      method: 'PUT',
      body: 'Attached pilot scope.',
    })
    const attachment = await saved.json()
    const listing = await (await f.app.request(`/docs/_api/attach/${f.work.path}`)).json()
    const current = await f.app.request(`/docs/_api/file/workstreams/atlas/${attachment.file}`)
    const older = await f.app.request('/docs/_api/file/workstreams/atlas/older.txt')
    assert({
      given: 'an uploaded workstream attachment and an older file in the user-data mirror',
      should: 'write new content in state while retaining existing links to older media',
      actual: [
        saved.status,
        await current.text(),
        listing.files.some((file: { name: string }) => file.name === attachment.file),
        await older.text(),
        await readFile(path.join(f.content, 'workstreams', 'atlas', attachment.file), 'utf8'),
        await stat(path.join(f.notebook, 'workstreams')).then(
          () => true,
          () => false,
        ),
      ],
      expected: [200, 'Attached pilot scope.', true, 'Earlier attachment.', 'Attached pilot scope.', false],
    })
  } finally {
    await f.clean()
  }
})
