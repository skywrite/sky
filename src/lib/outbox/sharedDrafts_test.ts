import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { workstreamOutboxContext } from '#lib/workstreams/outbox.ts'
import { createWorkstreamStorage } from '#lib/workstreams/storage.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema } from '#lib/workstreams/types.ts'
import { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { currentDraftVersion } from '#lib/writingVoice/draftTypes.ts'
import { failure, sampleOutboxItem, voiceFixture } from '#lib/writingVoice/testHelpers.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { checkOutboxDraft, createOutboxDraftGuard } from './draftContext.ts'
import { OutboxReview } from './review.ts'
import { createSavedMessages, SavedMessages } from './sources.ts'
import { outboxStateDir } from './storage.ts'
import { OutboxStore } from './store.ts'
import type { OutboxItem } from './types.ts'

const NOW = '2025-03-15 12:00:00 UTC'
const configFor = (root: string) => ({
  DIR_BASE: root,
  DIR_STATE: path.join(root, 'state'),
  DIR_STATE_FOLLOW_SLACK_ACTIVE: path.join(root, 'follows', 'slack'),
  DIR_STATE_FOLLOW_SLACK_ARCHIVE: path.join(root, 'follows', 'slack-archive'),
  DIR_STATE_FOLLOW_EMAIL_ACTIVE: path.join(root, 'follows', 'email'),
  DIR_STATE_FOLLOW_EMAIL_ARCHIVE: path.join(root, 'follows', 'email-archive'),
})

async function fixture(guard?: (root: string) => WritingDraftStore['beforeChange']) {
  const f = await voiceFixture()
  const dir = outboxStateDir(configFor(f.root))
  const drafts = new WritingDraftStore(
    f.voice,
    () => NOW,
    async () => 'Atlas API Update',
    guard?.(f.root) ??
      ((draft, author) => checkOutboxDraft(dir, draft, author, new SavedMessages(f.root, { Slack: [], Email: [] }))),
  )
  const store = new OutboxStore(dir, dir, f.store, drafts)
  const seed = { ...sampleOutboxItem(), origin: 'followup' as const }
  seed.conversation.target = { medium: 'Email', account: 'jane@example.com', thread: 'mock-thread' }
  return {
    ...f,
    drafts,
    outbox: store,
    seed,
    /** A draft gets its notebook record at its first use; opening its discussion is the plainest one. */
    worked: async (item: OutboxItem) => {
      const put = await store.put(item, null)
      return store.changeDraft(put.id, put.revision, { action: 'adopt' })
    },
    draftFiles: () => readdir(path.join(f.store.dir, 'drafts')).catch(() => [] as string[]),
    clean: async () => {
      await drafts.idle()
      await f.dispose()
    },
  }
}

test('Outbox and chat edit one draft record and share version history and learning', async () => {
  const f = await fixture()
  try {
    const item = await f.worked(f.seed)
    const id = item.draftId!
    await f.drafts.revise(id, 1, 'The Atlas API is ready.', 'you', 'Name the subject directly.')
    f.drafts.learn(id)
    await f.drafts.idle()
    const fromChat = (await f.outbox.get(item.id))!
    const stale = await failure(f.outbox.put({ ...item, draft: 'An obsolete reply.' }, item.revision))
    const fromOutbox = await f.outbox.changeDraft(item.id, fromChat.revision, {
      action: 'edit',
      revision: 2,
      text: 'Please review the Atlas API.',
      explanation: 'Ask for the next action.',
    })
    await f.drafts.idle()
    const saved = await f.drafts.require(id)
    const raw = await readFile(path.join(f.outbox.dir, 'items', `${item.id}.md`), 'utf8')
    assert({
      given: 'one edit in chat followed by one edit in Outbox',
      should: 'use one canonical file, reject stale writes, and learn each edit once without approving delivery',
      actual: [
        item.draftId,
        fromChat.draft,
        stale.includes('decision changed'),
        fromOutbox.draftId,
        saved.versions.map((v) => v.text),
        (await f.drafts.learning.edits(`draft:${id}`)).length,
        fromOutbox.status,
        fromOutbox.native,
        fromOutbox.delivery,
        path.resolve(path.join(f.outbox.dir, 'items'), decodeURIComponent(/\[Draft\]\((.+)\)/.exec(raw)![1])) ===
          path.join(f.store.dir, 'drafts', `${id}.md`),
        raw.includes('Please review the Atlas API.'),
      ],
      expected: [
        '2025-03-15_12-00-00Z_Atlas-API-Update',
        'The Atlas API is ready.',
        true,
        id,
        [f.seed.draft, 'The Atlas API is ready.', 'Please review the Atlas API.'],
        2,
        'needs_review',
        null,
        undefined,
        true,
        false,
      ],
    })
    const restored = await f.outbox.changeDraft(item.id, fromOutbox.revision, {
      action: 'restore',
      revision: 3,
      version: 1,
    })
    await f.drafts.idle()
    assert({
      given: 'an old version restored from Outbox',
      should: 'append history without treating Undo as a new writing preference',
      actual: [restored.draft, restored.writingDraft?.revision, (await f.drafts.learning.edits()).length],
      expected: [f.seed.draft, 4, 2],
    })
  } finally {
    await f.clean()
  }
})

test('draft discussions use configured follows and reject new messages or changed context during writing', async () => {
  const f = await fixture((root) => createOutboxDraftGuard(configFor(root)))
  try {
    const config = configFor(f.root)
    const sources = createSavedMessages(config)
    const firstRef = '2025-03-15/actions/messages/email_Atlas.md'
    const nextRef = '2025-03-16/actions/messages/email_Atlas.md'
    const writeMessage = async (ref: string, body: string) => {
      const file = path.join(f.root, resolveTimeRef(ref))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, new Document({ medium: 'Email', follow: 'atlas', from: 'Jane Doe' }, body).toMarkdown())
    }
    const follow = async (refs: string[]) => {
      await mkdir(config.DIR_STATE_FOLLOW_EMAIL_ACTIVE, { recursive: true })
      await writeFile(
        path.join(config.DIR_STATE_FOLLOW_EMAIL_ACTIVE, 'atlas.yaml'),
        JSON.stringify({
          source: 'Email',
          ref: { account: 'jane@example.com', threadId: '123456' },
          messages: refs.map((ref) => ({ date: ref.slice(0, 10), path: ref })),
        }),
      )
    }
    await writeMessage(firstRef, 'Please review the Atlas API.')
    await follow([firstRef])
    const conversation = (await sources.conversation(firstRef))!
    const item = await f.worked({ ...f.seed, conversation })
    const proposed = await f.drafts.revise(item.draftId!, 1, 'I will review the Atlas API.', 'sky')
    await writeMessage(nextRef, 'Please wait for the revised API specification.')
    await follow([firstRef, nextRef])
    const staleSources = await failure(
      f.drafts.revise(item.draftId!, proposed.revision, 'An obsolete revision.', 'sky'),
    )
    const latest = (await f.outbox.get(item.id))!
    const refreshed = await f.outbox.put(
      { ...latest, conversation: await sources.current(conversation), stale: true },
      latest.revision,
    )
    const staleContext = await failure(
      f.drafts.revise(item.draftId!, proposed.revision, 'An obsolete revision.', 'sky', '', undefined, proposed.input),
    )
    const manual = await f.drafts.revise(
      item.draftId!,
      proposed.revision,
      'I will wait for the updated specification.',
      'you',
    )
    assert({
      given: 'a verified email follow, a later captured message, and a context-only refresh while Sky writes',
      should: 'allow valid revisions, reject both kinds of stale proposal, and preserve an owner edit',
      actual: [
        proposed.revision,
        staleSources.includes('New messages arrived'),
        refreshed.writingDraft?.revision,
        staleContext.includes('context changed'),
        currentDraftVersion(manual).text,
        (await f.outbox.get(item.id))?.delivery,
      ],
      expected: [2, true, 2, true, 'I will wait for the updated specification.', undefined],
    })
  } finally {
    await f.clean()
  }
})

test('draft discussions check linked work before saving an AI revision', async () => {
  const f = await fixture((root) => createOutboxDraftGuard(configFor(root)))
  try {
    const storage = createWorkstreamStorage(configFor(f.root))
    const workstreams = new WorkstreamStore(
      storage.dir,
      storage.stateDir,
      f.root,
      undefined,
      storage.contentRoot,
      storage.initialize,
    )
    const work = await workstreams.create(
      {
        title: 'Atlas launch',
        outcome: 'Approve the API',
        activities: [ActivitySchema.parse({ id: 'review', title: 'Request review' })],
      },
      '2025-03-15 12:00:00',
    )
    const links = await workstreamOutboxContext(workstreams, [
      {
        workstreamId: work.id,
        activityId: 'review',
        decisionIds: [],
        title: work.title,
        context: '',
        contextVersion: '',
      },
    ])
    const item = await f.worked({ ...f.seed, workstreams: links })
    await f.drafts.beforeChange(item.writingDraft!, 'sky')
    await workstreams.put({ ...work, outcome: 'Review the revised API before approval' }, work.revision)
    const result = await failure(f.drafts.revise(item.draftId!, 1, 'A proposal based on the old outcome.', 'sky'))
    assert({
      given: 'linked work changes after opening a draft discussion',
      should: 'refuse to save an AI revision based on the obsolete context',
      actual: [result.includes('linked work changed'), (await f.outbox.get(item.id))?.draft],
      expected: [true, item.draft],
    })
  } finally {
    await f.clean()
  }
})

test('shared draft revisions cannot outrun approval or change text during native placement', async () => {
  const f = await fixture()
  try {
    const item = await f.worked(f.seed)
    let writes = 0
    const sources = new SavedMessages(f.root, { Slack: [], Email: [] })
    const staleReview = new OutboxReview(
      f.outbox,
      sources,
      async () => {
        writes++
        return { id: 'native', url: 'https://example.com/draft' }
      },
      () => NOW,
      async () => {
        await f.drafts.revise(item.draftId!, 1, 'A newer chat edit.', 'you')
      },
    )
    const conflict = await failure(staleReview.approve(item.id, item.revision, item.draft, false))
    const current = (await f.outbox.get(item.id))!
    let guarded = ''
    const review = new OutboxReview(
      f.outbox,
      sources,
      async () => {
        guarded = await failure(
          f.drafts.revise(current.draftId!, current.writingDraft!.revision, 'A late edit.', 'you'),
        )
        writes++
        return { id: 'native', url: 'https://example.com/draft' }
      },
      () => NOW,
    )
    const ready = await review.approve(current.id, current.revision, current.draft, false)
    await f.drafts.revise(ready.draftId!, ready.writingDraft!.revision, 'A revision after placement.', 'sky')
    const changed = (await f.outbox.get(item.id))!
    assert({
      given: 'chat edits before, during, and after the native draft handoff',
      should: 'reject stale approval, freeze the handed-off text, and require review of a later revision',
      actual: [
        conflict.includes('decision changed'),
        guarded.includes('placement'),
        writes,
        ready.draft,
        changed.stale,
        changed.reviews.at(-1)?.final,
        changed.delivery,
      ],
      expected: [true, true, 1, 'A newer chat edit.', true, 'A newer chat edit.', undefined],
    })
  } finally {
    await f.clean()
  }
})

test('an older reply kept in its item is saved at its first use, with its known history and no repeated learning', async () => {
  const f = await fixture()
  try {
    const legacy = new OutboxStore(f.outbox.dir, f.outbox.stateDir)
    const previous = await legacy.put({ ...f.seed, draft: 'An existing owner edit.', edited: true }, null)
    const opened = (await f.outbox.get(previous.id))!
    const filesWhenOpened = await f.draftFiles()
    const adopted = await f.outbox.changeDraft(previous.id, opened.revision, { action: 'adopt' })
    const again = await f.outbox.changeDraft(previous.id, adopted.revision, { action: 'adopt' })
    await f.drafts.idle()
    assert({
      given: 'an old inline draft opened, then worked on twice with the shared store',
      should:
        'write nothing when opened, then save one record with its original and latest text and keep the review state',
      actual: [
        opened.draftId,
        filesWhenOpened,
        opened.unsavedDraft?.versions.map((v) => [v.author, v.text]),
        adopted.draftId === again.draftId,
        adopted.writingDraft?.versions.map((v) => v.text),
        adopted.status,
        adopted.edited,
        (await f.drafts.learning.edits()).length,
        (await f.draftFiles()).length,
      ],
      expected: [
        undefined,
        [],
        [
          ['sky', f.seed.originalDraft],
          ['you', 'An existing owner edit.'],
        ],
        true,
        [f.seed.originalDraft, 'An existing owner edit.'],
        'needs_review',
        true,
        0,
        1,
      ],
    })
    await f.outbox.put({ ...again, status: 'dismissed' }, again.revision)
    const dismissed = (await f.outbox.get(adopted.id))!
    const next = await f.outbox.put(
      { ...dismissed, status: 'needs_review', draft: 'A new request needs a reply.' },
      dismissed.revision,
    )
    assert({
      given: 'a new request in a conversation with a dismissed reply',
      should: 'keep the old draft history intact and leave the new reply unsaved until it is used',
      actual: [
        next.draftId,
        next.unsavedDraft?.versions.at(-1)?.text,
        currentDraftVersion(await f.drafts.require(adopted.draftId!)).text,
        (await f.draftFiles()).length,
      ],
      expected: [undefined, 'A new request needs a reply.', 'An existing owner edit.', 1],
    })
  } finally {
    await f.clean()
  }
})

test('a draft nobody has worked on stays out of the notebook until its first use', async () => {
  const f = await fixture()
  try {
    const item = await f.outbox.put(f.seed, null)
    const recomposed = await f.outbox.put(
      {
        ...item,
        draft: 'The Atlas API is ready for review.',
        edited: true,
        replyDirections: [{ at: NOW, text: 'Name the API.', sourceVersion: 'v1' }],
      },
      item.revision,
      { author: 'sky', direction: 'Name the API.' },
    )
    const raw = await readFile(path.join(f.outbox.dir, 'items', `${item.id}.md`), 'utf8')
    const untouched = await f.draftFiles()
    const reread = (await f.outbox.get(item.id))!
    assert({
      given: 'a reply Sky prepared, then composed again from a direction, with nothing done to its words',
      should: 'keep the words in the item, show them with their history, and write no draft file',
      actual: [
        item.draftId,
        recomposed.draftId,
        untouched,
        raw.includes('The Atlas API is ready for review.'),
        recomposed.unsavedDraft?.versions.map((v) => [v.author, v.text, v.direction]),
        JSON.stringify(reread.unsavedDraft) === JSON.stringify(recomposed.unsavedDraft),
      ],
      expected: [
        undefined,
        undefined,
        [],
        true,
        [
          ['sky', f.seed.originalDraft, ''],
          ['sky', 'The Atlas API is ready for review.', 'Name the API.'],
        ],
        true,
      ],
    })
    const edited = await f.outbox.changeDraft(item.id, recomposed.revision, {
      action: 'edit',
      revision: recomposed.unsavedDraft!.revision,
      text: 'The Atlas API is ready. Please review it.',
      explanation: 'Ask for the next action.',
    })
    await f.drafts.idle()
    const saved = await f.drafts.require(edited.draftId!)
    assert({
      given: 'the first edit in the shared editor',
      should: 'save one readably named record with the shown history, and learn from that edit alone',
      actual: [
        edited.draftId,
        await f.draftFiles(),
        saved.versions.map((v) => [v.author, v.text]),
        saved.versions.at(-1)?.learnFrom,
        (await f.drafts.learning.edits(`draft:${edited.draftId}`)).length,
      ],
      expected: [
        '2025-03-15_12-00-00Z_Atlas-API-Update',
        ['2025-03-15_12-00-00Z_Atlas-API-Update.md'],
        [
          ['sky', f.seed.originalDraft],
          ['sky', 'The Atlas API is ready for review.'],
          ['you', 'The Atlas API is ready. Please review it.'],
        ],
        2,
        1,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('approving or reporting a send saves the record; archiving an untouched draft never does', async () => {
  const f = await fixture()
  try {
    const sources = new SavedMessages(f.root, { Slack: [], Email: [] })
    const review = new OutboxReview(
      f.outbox,
      sources,
      async () => ({ id: 'native', url: 'https://example.com/draft' }),
      () => NOW,
    )
    const other = (id: string, key: string) => ({
      ...f.seed,
      id: id.repeat(32),
      conversation: { ...f.seed.conversation, key },
    })
    const approve = await f.outbox.put(f.seed, null)
    const archive = await f.outbox.put(other('b', 'archived'), null)
    const send = await f.outbox.put(other('c', 'sent'), null)
    const archived = await review.dismiss(archive.id, archive.revision)
    const afterArchive = await f.draftFiles()
    const ready = await review.approve(approve.id, approve.revision, approve.draft, false)
    const sent = await review.reportSent(send.id, send.revision, 'Sent by email on 2025-03-15.')
    await f.drafts.idle()
    assert({
      given: 'three untouched replies: one archived, one approved as written, one reported sent',
      should: 'write a record for the two that left review, accept their first version, and teach nothing',
      actual: [
        archived.draftId,
        afterArchive,
        ready.writingDraft?.versions.map((v) => [v.author, v.accepted, v.learnFrom]),
        sent.draftId !== undefined,
        (await f.draftFiles()).length,
        (await f.drafts.learning.edits()).length,
      ],
      expected: [undefined, [], [['sky', true, undefined]], true, 2, 0],
    })
  } finally {
    await f.clean()
  }
})

test('a draft file deleted from the notebook never breaks its item', async () => {
  const f = await fixture()
  try {
    const sources = new SavedMessages(f.root, { Slack: [], Email: [] })
    const review = new OutboxReview(
      f.outbox,
      sources,
      async () => ({ id: 'native', url: 'https://example.com/draft' }),
      () => NOW,
    )
    const untouched = await f.worked({
      ...f.seed,
      id: 'b'.repeat(32),
      conversation: { ...f.seed.conversation, key: 'b' },
    })
    const item = await f.outbox.put(f.seed, null)
    const ready = await review.approve(item.id, item.revision, 'The draft is ready.', false)
    for (const id of [untouched.draftId!, ready.draftId!]) await rm(path.join(f.store.dir, 'drafts', `${id}.md`))
    const listed = await f.outbox.list()
    const approved = listed.find((entry) => entry.id === item.id)!
    const plain = listed.find((entry) => entry.id === untouched.id)!
    const archived = await f.outbox.put({ ...approved, status: 'dismissed' }, approved.revision)
    const raw = await readFile(path.join(f.outbox.dir, 'items', `${item.id}.md`), 'utf8')
    assert({
      given: 'an approved reply and an untouched one whose draft files the owner deleted',
      should: 'list both from the words their items hold, and drop the dead link at the next write',
      actual: [
        [approved.draft, approved.draftId, approved.writingDraft],
        [plain.draft, plain.draftId, plain.unsavedDraft?.revision],
        archived.draftId,
        Document.fromMarkdown(raw).yaml.draftId,
        Document.fromMarkdown(raw).markdown.trim(),
        await f.draftFiles(),
      ],
      expected: [
        ['The draft is ready.', undefined, undefined],
        [f.seed.originalDraft, undefined, 1],
        undefined,
        undefined,
        'The draft is ready.',
        [],
      ],
    })
  } finally {
    await f.clean()
  }
})
