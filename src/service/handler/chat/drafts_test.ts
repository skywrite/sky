import { mkdtemp, readdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { currentDraftVersion, type WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { assert, test } from '#test'
import { EDITED_DRAFT, ORIGINAL_DRAFT, WARM_DRAFT, writingDraftTestHost } from './draftsTestHelpers.ts'
import { createChatRoutes } from './mod.ts'

type App = ReturnType<typeof createChatRoutes>
const post = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const read = async (app: App, url: string) => (await app.request(url)).json() as Promise<any>
const current = async (app: App, id = 'main') => (await read(app, `/${id}/drafts`)).drafts[0] as WritingDraftView
const draftFiles = (root: string) => readdir(path.join(root, 'me', 'voice', 'drafts')).catch(() => [] as string[])
const send = async (app: App, id: string, message: string) => {
  const response = await post(app, `/${id}/messages`, {
    message,
    profile: 'test-thread-model',
    contextTokens: 0,
    saves: true,
  })
  const text = await response.text()
  if (!response.ok || text.includes('event: error')) throw new Error(text)
}

test('chat draft edits, thread revisions and accepted explanations share durable history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-writing-'))
  const briefs: string[] = []
  let host = writingDraftTestHost(root, { briefs })
  try {
    let app = createChatRoutes(host)
    await send(app, 'main', 'Draft an email to Jane.')
    const shown = await current(app)
    const filesBeforeUse = await draftFiles(root)
    const originalChat = await read(app, '/main')
    const explanation = 'Make the requested action and timing explicit for the recipient.'
    const edited = await post(app, `/main/drafts/${shown.id}`, {
      action: 'edit',
      revision: shown.revision,
      text: EDITED_DRAFT,
      explanation,
    })
    const first = ((await edited.clone().json()) as { draft: WritingDraftView }).draft
    await host.writingDrafts.idle()
    assert({
      given: 'a draft Sky wrote in chat, then the owner’s first edit in its frame',
      should: 'write no file until that edit, then save one readably named record in place of the shown frame',
      actual: [
        shown.unsaved,
        filesBeforeUse,
        first.unsaved,
        await draftFiles(root),
        ((await read(app, '/main/drafts')).drafts as WritingDraftView[]).map((draft) => draft.id),
      ],
      expected: [true, [], undefined, [`${first.id}.md`], [first.id]],
    })
    const example = (await host.writingDrafts.voice.store.list(`draft:${first.id}`))[0]!
    const stale = await post(app, `/main/drafts/${first.id}`, {
      action: 'edit',
      revision: shown.revision,
      text: 'Obsolete text',
    })
    assert({
      given: 'a saved direct edit with its explanation followed by a stale save',
      should: 'retain the exact pair and reason without a redundant question or lost update',
      actual: [
        edited.status,
        first.id.endsWith('_Atlas-Review'),
        stale.status,
        example.original,
        example.revised,
        example.answer,
        example.question,
        currentDraftVersion(await current(app)).text,
      ],
      expected: [200, true, 409, ORIGINAL_DRAFT, EDITED_DRAFT, explanation, undefined, EDITED_DRAFT],
    })

    const opened = await post(app, '/main/replies', { ...originalChat.branchPoints[1], draftId: first.id })
    const child = ((await opened.json()) as { id: string }).id
    await send(app, child, 'Make this warmer; I want the request to feel appreciative.')
    await host.writingDrafts.idle()
    const proposed = await current(app)
    assert({
      given: 'Ask Sky opens a thread on the edited draft',
      should: 'update the same record while keeping the main conversation and unaccepted learning unchanged',
      actual: [
        proposed.id,
        currentDraftVersion(proposed).text,
        (await read(app, '/main')).turns,
        (await host.writingDrafts.voice.store.list()).length,
        briefs.at(-1)?.includes(EDITED_DRAFT.replaceAll('\n', '\\n')),
      ],
      expected: [first.id, WARM_DRAFT, originalChat.turns, 1, true],
    })
    await post(app, `/${child}/drafts/${first.id}`, { action: 'accept', revision: proposed.revision })
    await host.writingDrafts.idle()
    const lessons = await host.writingDrafts.voice.store.list(`draft:${first.id}`)
    assert({
      given: 'the owner accepts the AI revision in its frame',
      should: 'learn using their actual editing direction',
      actual: lessons.some(
        (entry) =>
          entry.original === EDITED_DRAFT &&
          entry.revised === WARM_DRAFT &&
          entry.answer === 'Make this warmer; I want the request to feel appreciative.',
      ),
      expected: true,
    })

    host = writingDraftTestHost(root, { briefs })
    app = createChatRoutes(host)
    const recovered = await current(app)
    const reply = await current(app, child)
    const restored = await post(app, `/main/drafts/${first.id}`, {
      action: 'restore',
      revision: recovered.revision,
      version: 1,
    })
    const restoredDraft = ((await restored.json()) as { draft: WritingDraftView }).draft
    await host.writingDrafts.idle()
    assert({
      given: 'a server restart and restoring an earlier version',
      should:
        'recover shared identities and append the restoration without deleting versions or manufacturing another lesson',
      actual: [
        reply.id,
        restoredDraft.versions.map((version) => version.text),
        (await host.writingDrafts.voice.store.list()).length,
      ],
      expected: [first.id, [ORIGINAL_DRAFT, EDITED_DRAFT, WARM_DRAFT, ORIGINAL_DRAFT], 2],
    })
    const closed = await post(app, '/main/end', { save: true })
    const saved = ((await closed.json()) as { saved: { path: string } }).saved
    const loaded = await loadResumeSession(saved.path, { baseDir: root })
    assert({
      given: 'a filed chat',
      should: 'retain its editable draft link',
      actual: [closed.status, loaded.state.writingDrafts?.map((ref) => ref.id)],
      expected: [200, [first.id]],
    })
    const reopened = await post(app, '/open', { chat: path.relative(root, saved.path) })
    const reopenedId = ((await reopened.json()) as { id: string }).id
    const again = await current(app, reopenedId)
    assert({
      given: 'the saved conversation reopened under a new runtime ID',
      should: 'show the same draft and all earlier versions',
      actual: [again.id, again.revision],
      expected: [first.id, 4],
    })
  } finally {
    await host.writingDrafts.idle()
    await rm(root, { recursive: true, force: true })
  }
})

test('draft mutation validates ownership and branches keep independent copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-draft-scope-'))
  const host = writingDraftTestHost(root)
  try {
    const app = createChatRoutes(host)
    await send(app, 'main', 'Draft an email.')
    await send(app, 'other', 'Draft another email.')
    const shown = await current(app)
    const badOwner = await post(app, `/other/drafts/${shown.id}`, {
      action: 'edit',
      revision: 1,
      text: 'Wrong conversation',
    })
    const invalid = await post(app, `/main/drafts/${shown.id}`, { action: 'restore', revision: 1, version: 100 })
    const filesAfterRefusals = await draftFiles(root)
    const adopted = await post(app, `/main/drafts/${shown.id}`, { action: 'adopt' })
    const draft = ((await adopted.json()) as { draft: WritingDraftView }).draft
    const main = await read(app, '/main')
    const branch = await post(app, '/main/branch', main.branchPoints[1])
    const id = ((await branch.json()) as { id: string }).id
    const fork = await current(app, id)
    await post(app, `/${id}/drafts/${fork.id}`, { action: 'edit', revision: fork.revision, text: EDITED_DRAFT })
    assert({
      given: 'an unrelated chat, an invalid restore, then a draft the owner works on and a separate branch',
      should: 'save nothing for a refused write, and leave the original intact when the branch edits its own copy',
      actual: [
        badOwner.status,
        invalid.status,
        filesAfterRefusals,
        fork.unsaved,
        fork.id !== draft.id,
        currentDraftVersion(await current(app)).text,
        currentDraftVersion(await current(app, id)).text,
        (await draftFiles(root)).length,
      ],
      expected: [404, 400, [], undefined, true, ORIGINAL_DRAFT, EDITED_DRAFT, 2],
    })
    await rm(path.join(root, 'me', 'voice', 'drafts', `${draft.id}.md`))
    const afterDelete = await current(app)
    const second = await post(app, '/main/branch', main.branchPoints[1])
    assert({
      given: 'the owner deletes the draft’s file from the notebook',
      should: 'show the words from the chat as an unsaved draft again, and still branch',
      actual: [afterDelete.unsaved, currentDraftVersion(afterDelete).text, second.status],
      expected: [true, ORIGINAL_DRAFT, 201],
    })
  } finally {
    await host.writingDrafts.idle()
    await rm(root, { recursive: true, force: true })
  }
})

test('older writer results become editable on demand without duplicating their draft or changing the transcript', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-old-draft-'))
  const host = writingDraftTestHost(root)
  try {
    const first = createChatRoutes(host)
    await send(first, 'main', 'Draft an email.')
    const snapshots = await host.snapshots!()
    for (const snapshot of snapshots) {
      delete snapshot.state.writingDrafts
      delete snapshot.state.writingDraftFocus
      delete snapshot.runs
    }
    const app = createChatRoutes({ ...host, snapshots: async () => snapshots })
    const candidate = await current(app)
    const conversation = (await read(app, '/main')).turns
    assert({
      given: 'a recovered chat with a successful me_voice result predating draft records',
      should: 'show an editable candidate without creating a notebook record just by reading it',
      actual: [candidate.unsaved, currentDraftVersion(candidate).text, await host.writingDrafts.get(candidate.id)],
      expected: [true, ORIGINAL_DRAFT, null],
    })
    await post(app, `/main/drafts/${candidate.id}`, {
      action: 'edit',
      revision: 1,
      text: EDITED_DRAFT,
      explanation: 'Clarify the next action.',
    })
    await host.writingDrafts.idle()
    const drafts = (await read(app, '/main/drafts')).drafts as WritingDraftView[]
    assert({
      given: 'the owner edits that older result',
      should: 'adopt it once, retain the original and preserve the source response',
      actual: [
        drafts.length,
        drafts[0]!.unsaved,
        drafts[0]!.versions.map((v) => v.text),
        (await read(app, '/main')).turns,
      ],
      expected: [1, undefined, [ORIGINAL_DRAFT, EDITED_DRAFT], conversation],
    })
  } finally {
    await host.writingDrafts.idle()
    await rm(root, { recursive: true, force: true })
  }
})

test('a revision typed in the main chat is a first use: one record holds both versions from the turn they began', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-chat-typed-revision-'))
  const host = writingDraftTestHost(root)
  try {
    const app = createChatRoutes(host)
    await send(app, 'main', 'Draft an email to Jane.')
    const before = await draftFiles(root)
    await send(app, 'main', 'Make this warmer.')
    await host.writingDrafts.idle()
    const drafts = (await read(app, '/main/drafts')).drafts as WritingDraftView[]
    assert({
      given: 'a draft Sky wrote, then a revision the owner asked for in the conversation',
      should: 'write no file for the first draft, then save one record with both versions and teach nothing yet',
      actual: [
        before,
        (await draftFiles(root)).length,
        drafts.map((draft) => [draft.unsaved, draft.turn, draft.versions.map((version) => version.text)]),
        drafts[0]!.versions[1]!.direction,
        (await host.writingDrafts.voice.store.list()).length,
      ],
      expected: [[], 1, [[undefined, 1, [ORIGINAL_DRAFT, WARM_DRAFT]]], 'Make this warmer.', 0],
    })
  } finally {
    await host.writingDrafts.idle()
    await rm(root, { recursive: true, force: true })
  }
})
