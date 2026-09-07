import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { createImportRoutes, type ImportJob, type ImportRoutesOptions } from '../import/mod.ts'
import { readSrt } from '../import/readback.ts'
import { backlinksOf } from '../vocabulary/mod.ts'
import { changeLinks } from './content.ts'
import { createLinks } from './mod.ts'
import type { LinkSearch } from './types.ts'

const VIDEO = 'time/2026/W05/01-27/actions/videos/Loom_Atlas.md'
const CHAT = 'time/2026/W05/01-27/actions/ai-chats/09-00_Atlas.md'
const BRANCH = `${CHAT.slice(0, -3)}/10-00_Budget.md`
const MESSAGE = 'time/2026/W05/01-27/actions/messages/Email_Atlas.md'
const VIDEO_REF = '2026-01-27/actions/videos/Loom_Atlas'
const BRANCH_REF = '2026-01-27/actions/ai-chats/09-00_Atlas/10-00_Budget'
const FILED = 'time/2026/W05/01-28/actions/videos/Loom_followup.md'
const content = (summary: string, extras = '') =>
  `---\nsummary: ${summary}\nfrom: Jane Doe\n${extras}---\n\n# Record\n\nDetails to keep unchanged.\n`

async function notebook(run: (base: string, store: MarkdownStore) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'notebook-links-'))
  try {
    for (const [file, body] of Object.entries({
      [VIDEO]: content('Atlas walkthrough'),
      [CHAT]: content('Atlas planning'),
      [BRANCH]: content('Budget questions', `parent:\n  chat: ${CHAT}\n  turn: 2\n`),
      [MESSAGE]: content('Atlas follow-up email'),
      [FILED]: content('Atlas follow-up video', 'rel:\n  - Existing context\n'),
    })) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true })
      await writeFile(path.join(base, file), body)
    }
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [], timeDirs: [path.join(base, 'time')] })
    await run(base, store)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('link picker searches dates, people and types and distinguishes nested chat branches', async () => {
  await notebook(async (base, store) => {
    const app = createTestHttpApp([path.join(base, 'time')], { markdownStore: store })
    const search = async (query: string) =>
      (await (await app.request(`/docs/_api/links?${query}`)).json()) as LinkSearch
    const videos = await search('q=Atlas%20Jane&kind=video&day=2026-01-27')
    const branches = await search('q=Budget&kind=chat')
    assert({
      given: 'a video from yesterday and a nested branch',
      should: 'find the video by title and sender and show the branch point',
      actual: [videos.items.map((i) => [i.title, i.date, i.people]), branches.items.map((i) => [i.title, i.parent])],
      expected: [
        [['Atlas walkthrough', '2026-01-27', 'Jane Doe']],
        [['Budget questions', { path: CHAT, title: 'Atlas planning', turn: 2 }]],
      ],
    })
    assert({
      given: 'a current record excluded and a different type selected',
      should: 'filter before limiting results',
      actual: [
        (await search(`kind=video&exclude=${FILED}`)).items.map((i) => i.path),
        (await search('kind=message')).items.map((i) => i.path),
      ],
      expected: [[VIDEO], [MESSAGE]],
    })
  })
})

test('link picker finds person aliases and ranks them before paginating newer contextual matches', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'notebook-link-people-'))
  const people = path.join(base, 'people')
  try {
    await mkdir(people)
    await writeFile(
      path.join(people, 'Jane-Doe.md'),
      '---\nname: [Jane Doe, Jay]\nalt: JD\nnames: Janie\nupdated: 2025-01-01\n---\n',
    )
    for (let i = 0; i < 45; i++) {
      await writeFile(
        path.join(people, `Contact-${i}.md`),
        `---\nname: Contact ${i}\nsummary: Blue jay notes\nupdated: 2026-01-28\n---\n`,
      )
    }
    const store = await MarkdownStore.build({ peopleDirs: [people], orgDirs: [], timeDirs: [] })
    const app = createTestHttpApp([people], { markdownStore: store })
    const search = async (query: string, offset = 0, kind = 'person') => {
      const params = new URLSearchParams({ q: query, kind, offset: String(offset) })
      return (await (await app.request(`/docs/_api/links?${params}`)).json()) as LinkSearch
    }
    const first = await search('jay')
    const next = await search('jay', 40)
    assert({
      given: 'an old profile whose alias matches and more than a page of newer summary matches',
      should: 'return the person first, once, under the canonical link value',
      actual: [
        first.items[0]?.title,
        first.items[0]?.value,
        first.items[0]?.path,
        first.total,
        first.items.length,
        next.items.length,
        [...first.items, ...next.items].filter((item) => item.value === 'Jane Doe').length,
      ],
      expected: ['Jane Doe', 'Jane Doe', 'people/Jane-Doe.md', 46, 40, 6, 1],
    })
    assert({
      given: 'name-list, alt and names aliases, or the canonical name with mixed case and separators',
      should: 'resolve each query to the same person, including with all types selected',
      actual: await Promise.all(
        ['  JAY ', 'jd', 'janie', 'JANE_doe'].map(async (query) => (await search(query, 0, '')).items[0]?.value),
      ),
      expected: ['Jane Doe', 'Jane Doe', 'Jane Doe', 'Jane Doe'],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('link writes retain other metadata and body, deduplicate references and update backlinks immediately', async () => {
  await notebook(async (base, store) => {
    const { host } = createLinks(store, base, [path.join(base, 'time')])
    const ref = VIDEO_REF
    await host.validate([ref])
    await host.update(FILED, [ref], [])
    await host.update(FILED, [`${ref}.md`], [])
    const linked = await readFile(path.join(base, FILED), 'utf8')
    assert({
      given: 'the same record linked with and without its extension',
      should: 'write one reference and retain existing relations and prose',
      actual: linked,
      expected: content('Atlas follow-up video', `rel:\n  - Existing context\n  - ${ref}\n`),
    })
    assert({
      given: 'a new reference to the earlier video',
      should: 'show its readable title in Linked from immediately',
      actual: backlinksOf(store, base, VIDEO).map((i) => [i.path, i.label]),
      expected: [[FILED, 'Atlas follow-up video']],
    })
    await host.update(FILED, [], [`${ref}.md`])
    assert({
      given: 'removing the selected reference',
      should: 'keep the record and unrelated context',
      actual: await readFile(path.join(base, FILED), 'utf8'),
      expected: content('Atlas follow-up video', 'rel:\n  - Existing context\n'),
    })
    const rejected = await Promise.all(
      ['../outside.md', '/tmp/outside.md', 'missing'].map((value) =>
        host.validate([value]).then(
          () => false,
          () => true,
        ),
      ),
    )
    assert({
      given: 'references outside the indexed notebook',
      should: 'reject every one',
      actual: rejected,
      expected: [true, true, true],
    })
  })
})

test('changing links preserves YAML comments and CRLF and refuses invalid metadata', () => {
  const input = '---\r\n# Keep this comment\r\nsummary: "Atlas"\r\nrel: Jane Doe\r\n---\r\n\r\n# Body\r\n'
  const changed = changeLinks(input, ['projects/Atlas'], [])
  let rejected = false
  try {
    changeLinks('---\nrel: [broken\n---\nText', ['x'], [])
  } catch {
    rejected = true
  }
  assert({
    given: 'comments, quoted metadata, CRLF and malformed YAML',
    should: 'retain the document format and reject broken frontmatter',
    actual: [
      changed.includes('# Keep this comment\r\nsummary: "Atlas"'),
      changed.endsWith('\r\n\r\n# Body\r\n'),
      changed.includes('  - projects/Atlas'),
      rejected,
    ],
    expected: [true, true, true, true],
  })
})

test('import links survive resume and selections racing with filing reach the saved record', async () => {
  await notebook(async (base, store) => {
    const links = createLinks(store, base, [path.join(base, 'time')]).host
    let finish!: () => void
    let began!: () => void
    const ready = new Promise<void>((resolve) => {
      began = resolve
    })
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const options: ImportRoutesOptions = {
      dir: path.join(base, '.imports'),
      journalTypes: [],
      links,
      read: async () => readSrt('1\n00:00:00,000 --> 00:00:01,000\nAtlas follow-up\n', 'video.srt'),
      suggestWhen: () => '2026-01-28 10:00',
      run: async function* () {
        began()
        await finished
        return { ok: true, file: FILED }
      },
    }
    let app = createImportRoutes(options)
    const form = new FormData()
    form.append('file', new File(['transcript'], 'video.srt'))
    const { job } = (await (await app.request('/', { method: 'POST', body: form })).json()) as { job: ImportJob }
    const post = (route: string, body: unknown) =>
      app.request(`/${job.id}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    await post('links', { links: [VIDEO_REF] })
    app = createImportRoutes(options)
    const restored = (await (await app.request(`/${job.id}`)).json()) as { job: ImportJob }
    assert({
      given: 'an import reopened before Start',
      should: 'retain the selected record',
      actual: restored.job.links,
      expected: [VIDEO_REF],
    })
    await post('start', { kind: 'video', when: '2026-01-28 10:00' })
    await ready
    const selection = post('links', { links: [VIDEO_REF, BRANCH_REF] })
    finish()
    await selection
    let saved: ImportJob | undefined
    for (let i = 0; i < 100; i++) {
      saved = ((await (await app.request(`/${job.id}`)).json()) as { job: ImportJob }).job
      if (saved.state === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert({
      given: 'a branch selected just as the import finishes',
      should: 'file successfully with both explicit links and extracted context',
      actual: [
        saved?.state,
        saved?.linkError,
        (await readFile(path.join(base, FILED), 'utf8')).includes(`  - ${BRANCH_REF}`),
      ],
      expected: ['done', null, true],
    })
  })
})

test('a failed link save survives restart and retries without importing twice', async () => {
  await notebook(async (base, store) => {
    const host = createLinks(store, base, [path.join(base, 'time')]).host
    let canSave = false
    let runs = 0
    const options: ImportRoutesOptions = {
      dir: path.join(base, '.imports'),
      journalTypes: [],
      links: {
        ...host,
        update: async (...args) => {
          if (!canSave) throw new Error('A temporary write failure.')
          await host.update(...args)
        },
      },
      read: async () => readSrt('1\n00:00:00,000 --> 00:00:01,000\nAtlas\n', 'video.srt'),
      suggestWhen: () => '2026-01-28 10:00',
      run: async function* () {
        runs++
        return { ok: true, file: FILED }
      },
    }
    let app = createImportRoutes(options)
    const form = new FormData()
    form.append('file', new File(['transcript'], 'video.srt'))
    const { job } = (await (await app.request('/', { method: 'POST', body: form })).json()) as { job: ImportJob }
    const post = (route: string, body: unknown) =>
      app.request(`/${job.id}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    await post('links', { links: [VIDEO_REF] })
    await post('start', { kind: 'video', when: '2026-01-28 10:00' })
    let settled: ImportJob | undefined
    for (let i = 0; i < 100; i++) {
      settled = ((await (await app.request(`/${job.id}`)).json()) as { job: ImportJob }).job
      if (settled.state === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    app = createImportRoutes(options)
    const restored = ((await (await app.request(`/${job.id}`)).json()) as { job: ImportJob }).job
    assert({
      given: 'a filed record whose links could not be written, followed by restart',
      should: 'retain the filed result and retryable selections',
      actual: [restored.state, restored.result?.file, restored.links, Boolean(restored.linkError)],
      expected: ['done', FILED, [VIDEO_REF], true],
    })
    canSave = true
    const retried = ((await (await post('links', { links: [VIDEO_REF] })).json()) as { job: ImportJob }).job
    assert({
      given: 'retrying only the links',
      should: 'save them, clear the error, and keep a single import run',
      actual: [retried.linkError, retried.linked, runs],
      expected: [null, [VIDEO_REF], 1],
    })
  })
})
