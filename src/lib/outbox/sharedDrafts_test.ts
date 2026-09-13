import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
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
    clean: async () => {
      await drafts.idle()
      await f.dispose()
    },
  }
}

test('Outbox and chat edit one draft record and share version history and learning', async () => {
  const f = await fixture()
  try {
    const item = await f.outbox.put(f.seed, null)
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
        (await f.store.list(`draft:${id}`)).length,
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
      actual: [restored.draft, restored.writingDraft?.revision, (await f.store.list()).length],
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
    const item = await f.outbox.put({ ...f.seed, conversation }, null)
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

test('shared draft revisions cannot outrun approval or change text during native placement', async () => {
  const f = await fixture()
  try {
    const item = await f.outbox.put(f.seed, null)
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

test('adopting an existing Outbox reply preserves its known history without duplicating learning', async () => {
  const f = await fixture()
  try {
    const legacy = new OutboxStore(f.outbox.dir, f.outbox.stateDir)
    const previous = await legacy.put({ ...f.seed, draft: 'An existing owner edit.', edited: true }, null)
    const adopted = (await f.outbox.ensureDraft(previous.id))!
    const reread = (await f.outbox.ensureDraft(previous.id))!
    await f.drafts.idle()
    assert({
      given: 'an old inline draft opened repeatedly with the shared store',
      should: 'adopt it once with its original and latest text and keep the review state',
      actual: [
        adopted.draftId === reread.draftId,
        adopted.writingDraft?.versions.map((v) => v.text),
        adopted.status,
        adopted.edited,
        (await f.store.list()).length,
      ],
      expected: [true, [f.seed.originalDraft, 'An existing owner edit.'], 'needs_review', true, 0],
    })
    await f.outbox.put({ ...adopted, status: 'dismissed' }, adopted.revision)
    const dismissed = (await f.outbox.get(adopted.id))!
    const next = await f.outbox.put(
      { ...dismissed, status: 'needs_review', draft: 'A new request needs a reply.' },
      dismissed.revision,
    )
    assert({
      given: 'a new request in a conversation with a dismissed reply',
      should: 'keep the old draft history intact and give the new reply its own record',
      actual: [next.draftId !== adopted.draftId, currentDraftVersion(await f.drafts.require(adopted.draftId!)).text],
      expected: [true, 'An existing owner edit.'],
    })
  } finally {
    await f.clean()
  }
})
