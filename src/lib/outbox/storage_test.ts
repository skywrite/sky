import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as config from '#config'
import { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { failure, sampleOutboxItem, voiceFixture } from '#lib/writingVoice/testHelpers.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { createOutboxDraftGuard } from './draftContext.ts'
import { atomicWrite, withLock } from './files.ts'
import { createOutboxRuntime } from './runtime.ts'
import { createOutboxStorage, outboxStateDir } from './storage.ts'
import { OutboxStore } from './store.ts'

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  )
const TODAY = '2025-03-15'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-storage-'))
  const local = {
    ...config,
    DIR_BASE: path.join(root, 'Notebook #1 (mock)'),
    DIR_STATE: path.join(root, 'data', 'state'),
  }
  const dir = outboxStateDir(local)
  const legacy = new OutboxStore(path.join(local.DIR_BASE, 'outbox'), dir)
  return { root, local, dir, legacy, dispose: () => rm(root, { recursive: true, force: true }) }
}

test('production Outbox migrates all durable records beside existing scan state and keeps notebook scopes separate', async () => {
  const f = await fixture()
  try {
    const seed = sampleOutboxItem()
    const sent = await f.legacy.put(
      {
        ...seed,
        status: 'dismissed',
        edited: true,
        replyDirections: [{ at: TODAY, text: 'Name the next step.', sourceVersion: 'v1' }],
        reviews: [{ at: TODAY, original: 'An earlier draft.', final: seed.draft, sourceVersion: 'v1' }],
        native: { id: 'mock-native-draft', url: 'https://example.com/drafts/1' },
        delivery: { at: TODAY, evidence: 'Sent the reply.', kind: 'owner_report' },
        responseHistory: [
          { at: TODAY, evidence: 'Sent the reply.', kind: 'owner_report', sourceVersion: 'v1', reply: seed.draft },
        ],
        followupStatus: 'complete',
      },
      null,
    )
    const child = await f.legacy.put(
      {
        ...seed,
        id: 'b'.repeat(32),
        origin: 'followup',
        followupOf: {
          id: sent.id,
          title: sent.title,
          reply: sent.draft,
          commitment: 'Share the update.',
          at: TODAY,
          sourceVersion: 'v1',
        },
      },
      null,
    )
    const range = { start: '2025-03-09T00:00', end: '2025-03-15T23:59' }
    await f.legacy.saveScanRange(range, (await f.legacy.scanRange(TODAY)).revision, TODAY)
    await atomicWrite(path.join(f.legacy.dir, 'preferences.md'), '---\ncustom: keep\n---\nUse short paragraphs.\n')
    const metadata = new Document({ extra: 'Keep unrecognized fields.' }, 'Supporting notes.\n').toMarkdown()
    await atomicWrite(path.join(f.legacy.dir, 'notes.md'), metadata)
    const checkpoint = '{"handled":{"mock":"v1"},"pending":[]}'
    await atomicWrite(path.join(f.dir, 'sources.json'), checkpoint)
    await atomicWrite(path.join(f.dir, 'compose-jobs', sent.id, 'result.json'), '{"status":"complete"}')
    const runtime = createOutboxRuntime(f.local)
    const [items, selected, preferences] = await Promise.all([
      runtime.store.list(),
      runtime.store.scanRange(TODAY),
      runtime.store.preferences(),
    ])
    assert({
      given: 'reviewed, sent, and follow-up records in the notebook with existing worker state',
      should: 'retain their complete records and links in the same namespace as the scan checkpoints',
      actual: [
        runtime.store.dir === f.dir && runtime.store.stateDir === f.dir,
        // The editor's view of an untouched reply is derived on each read, never stored.
        items.map(({ unsavedDraft: _view, ...record }) => record).sort((a, b) => a.id.localeCompare(b.id)),
        selected.value,
        preferences.text.trim(),
        await readFile(path.join(f.dir, 'sources.json'), 'utf8'),
        await readFile(path.join(f.dir, 'compose-jobs', sent.id, 'result.json'), 'utf8'),
        await readFile(path.join(f.dir, 'notes.md'), 'utf8'),
        await exists(f.legacy.dir),
      ],
      expected: [
        true,
        [sent, child],
        range,
        'Use short paragraphs.',
        checkpoint,
        '{"status":"complete"}',
        metadata,
        false,
      ],
    })
    await runtime.store.put({ ...seed, id: 'c'.repeat(32), draft: '' }, null)
    const reopened = createOutboxRuntime(f.local).store
    const other = createOutboxRuntime({ ...f.local, DIR_BASE: path.join(f.root, 'Other notebook') }).store
    assert({
      given: 'a new write, a restarted host, and a second notebook sharing the data directory',
      should: 'keep all Outbox records in data state without recreating notebook/outbox or sharing the queue',
      actual: [
        (await reopened.list()).length,
        await exists(f.legacy.dir),
        other.dir !== reopened.dir,
        await other.list(),
      ],
      expected: [3, false, true, []],
    })
  } finally {
    await f.dispose()
  }
})

test('a shared draft discussion can migrate Outbox first and keeps editing and native handoff guards', async () => {
  const f = await voiceFixture()
  const local = {
    ...config,
    DIR_BASE: f.root,
    DIR_STATE: path.join(f.root, 'Data #1 (mock)', 'state'),
  }
  const storage = createOutboxStorage(local)
  const drafts = new WritingDraftStore(
    f.voice,
    () => '2025-03-15 12:00:00 UTC',
    async () => 'Atlas Update',
    createOutboxDraftGuard(local),
  )
  try {
    const legacy = new OutboxStore(path.join(f.root, 'outbox'), storage.dir, f.store, drafts)
    const prepared = await legacy.put(
      { ...sampleOutboxItem(), id: '2025-03-15_1200_Project-update', origin: 'followup' },
      null,
    )
    // A draft has a shared record only once the owner has worked on it.
    const item = await legacy.changeDraft(prepared.id, prepared.revision, { action: 'adopt' })
    const original = Document.fromMarkdown(await readFile(path.join(legacy.dir, 'items', `${item.id}.md`), 'utf8'))
    await drafts.revise(item.draftId!, 1, 'The Atlas update is ready.', 'you')
    const store = new OutboxStore(storage.dir, storage.dir, f.store, drafts, storage.initialize)
    const current = (await store.get(item.id))!
    const raw = await readFile(path.join(storage.dir, 'items', `${item.id}.md`), 'utf8')
    const link = decodeURIComponent(/\[Draft\]\((.+)\)/.exec(raw)![1])
    const draftFile = path.resolve(storage.dir, 'items', link)
    assert({
      given: 'Chat edits an existing shared draft before Outbox has been opened after the upgrade',
      should:
        'migrate its metadata, preserve its ID and history, and point its Markdown link at the same canonical file',
      actual: [
        current.draftId,
        current.draft,
        current.writingDraft?.versions.length,
        Document.fromMarkdown(raw).yaml,
        draftFile,
        await exists(draftFile),
        await exists(legacy.dir),
      ],
      expected: [
        item.draftId,
        'The Atlas update is ready.',
        2,
        original.yaml,
        path.join(f.store.dir, 'drafts', `${item.draftId}.md`),
        true,
        false,
      ],
    })
    const edited = await store.changeDraft(item.id, current.revision, {
      action: 'edit',
      revision: 2,
      text: 'Please review the Atlas update.',
      explanation: '',
    })
    await store.put({ ...edited, status: 'placement_unknown' }, edited.revision)
    assert({
      given: 'the relocated item has an unconfirmed native placement',
      should: 'still block edits through the shared draft store',
      actual: (await failure(drafts.revise(item.draftId!, 3, 'An unsafe edit.', 'you'))).includes('not confirmed'),
      expected: true,
    })
  } finally {
    await drafts.idle()
    await f.dispose()
  }
})

test('migration resumes identical partial copies and concurrent initializers without losing unknown metadata', async () => {
  const f = await fixture()
  try {
    const first = await f.legacy.put(sampleOutboxItem(), null)
    const second = await f.legacy.put({ ...sampleOutboxItem(), id: 'b'.repeat(32) }, null)
    const name = path.join('items', `${first.id}.md`)
    const text = (await readFile(path.join(f.legacy.dir, name), 'utf8')).replace(
      '---\n',
      '---\nfutureField: preserved\n',
    )
    await atomicWrite(path.join(f.legacy.dir, name), text)
    await atomicWrite(path.join(f.dir, name), text)
    const moved = path.join('items', `${second.id}.md`)
    await atomicWrite(path.join(f.dir, moved), await readFile(path.join(f.legacy.dir, moved), 'utf8'))
    await rm(path.join(f.legacy.dir, moved))
    await Promise.all([createOutboxStorage(f.local).initialize(), createOutboxStorage(f.local).initialize()])
    await createOutboxStorage(f.local).initialize()
    assert({
      given: 'one published copy still has its original and another has already been removed',
      should: 'finish the interrupted move once without rewriting the saved records',
      actual: [
        (await createOutboxRuntime(f.local).store.list()).length,
        await readFile(path.join(f.dir, name), 'utf8'),
        await exists(f.legacy.dir),
      ],
      expected: [2, text, false],
    })
  } finally {
    await f.dispose()
  }
})

test('migration refuses conflicting copies before moving anything and can retry after repair', async () => {
  const f = await fixture()
  try {
    const first = await f.legacy.put(sampleOutboxItem(), null)
    const second = await f.legacy.put({ ...sampleOutboxItem(), id: 'b'.repeat(32) }, null)
    const name = path.join('items', `${second.id}.md`)
    const target = path.join(f.dir, name)
    await atomicWrite(target, 'Keep this different copy.\n')
    const storage = createOutboxStorage(f.local)
    assert({
      given: 'the data directory already contains different text for a legacy record',
      should: 'report the conflict and preserve every original and destination',
      actual: [
        (await failure(storage.initialize())).includes('Both copies were kept'),
        await readFile(target, 'utf8'),
        (await f.legacy.list()).length,
        await exists(path.join(f.dir, 'items', `${first.id}.md`)),
      ],
      expected: [true, 'Keep this different copy.\n', 2, false],
    })
    await rm(target)
    await storage.initialize()
    assert({
      given: 'the conflict is repaired',
      should: 'retry the same initializer successfully',
      actual: await exists(f.legacy.dir),
      expected: false,
    })
  } finally {
    await f.dispose()
  }
})

test('migration waits for an old scanner and refuses symbolic links', async () => {
  const f = await fixture()
  try {
    const item = await f.legacy.put(sampleOutboxItem(), null)
    const storage = createOutboxStorage(f.local)
    let pending: Promise<void> | undefined
    await withLock(path.join(f.dir, 'scan.lock'), async () => {
      pending = storage.initialize()
      await delay(60)
      assert({
        given: 'an older scan still owns the existing scan lock',
        should: 'leave its notebook records in place until it finishes',
        actual: [await exists(f.legacy.dir), await exists(path.join(f.dir, 'items', `${item.id}.md`))],
        expected: [true, false],
      })
    })
    await pending
    await mkdir(f.legacy.dir)
    const outside = path.join(f.root, 'keep.txt')
    await writeFile(outside, 'Unrelated content.')
    await symlink(outside, path.join(f.legacy.dir, 'linked.md'))
    const error = await failure(createOutboxStorage(f.local).initialize())
    assert({
      given: 'the legacy directory contains a link to another file',
      should: 'stop instead of moving or following the link',
      actual: [
        error.includes('ordinary file'),
        await readFile(outside, 'utf8'),
        await exists(path.join(f.dir, 'linked.md')),
      ],
      expected: [true, 'Unrelated content.', false],
    })
  } finally {
    await f.dispose()
  }
})
