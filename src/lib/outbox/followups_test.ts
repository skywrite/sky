import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { createFollowupPlanner, queueFollowups, reconcileFollowups } from './followups.ts'
import { OutboxReview } from './review.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import type { FollowupProposal, OutboxRecord, PrepareFollowups } from './types.ts'

const NOW = '2025-03-15 12:00'
const REPLY = 'I’ll ask Casey Example to post the weekly update in the shared channel.'
const proposal: FollowupProposal = {
  recipient: 'Casey Example',
  commitment: REPLY,
  title: 'Ask Casey to share the weekly update',
  situation: 'Your reply to Jane calls for Casey to share the weekly update with the group.',
  draft: 'Casey, please post the weekly update in the shared channel so the group can see it.',
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-followup-test-'))
  const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const ref = '2025-03-15/actions/messages/slack_Atlas.md'
  const file = path.join(root, resolveTimeRef(ref))
  await mkdir(path.dirname(file), { recursive: true })
  const write = (body: string) =>
    writeFile(
      file,
      new Document(
        {
          from: 'Jane Doe',
          to: 'Alex Example',
          medium: 'Slack',
          link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100',
        },
        body,
      ).toMarkdown(),
    )
  await write('Could the weekly update be shared with the group?')
  const conversation = (await sources.conversation(ref))!
  const item = await store.put(
    {
      id: '2025-03-15_1200_Reply-to-Jane-about-the-weekly',
      created: NOW,
      updated: NOW,
      status: 'needs_review',
      conversation,
      title: 'Reply to Jane about the weekly update',
      situation: 'Jane wants the group to see the weekly update.',
      reasoning: 'The request needs a reply.',
      questions: [],
      originalDraft: 'I’ll ask Morgan Example to share it tomorrow.',
      draft: 'I’ll ask Morgan Example to share it tomorrow.',
      edited: false,
      stale: false,
      reviews: [],
      native: null,
      placementError: null,
    },
    null,
  )
  const placements: OutboxRecord[] = []
  const review = (prepare: PrepareFollowups = async () => [proposal], failPlacement = false) =>
    new OutboxReview(
      store,
      sources,
      async (record) => {
        placements.push(record)
        if (failPlacement) throw new Error('Native result unknown')
        return { id: 'native-draft', url: 'https://example.com/draft' }
      },
      () => NOW,
      undefined,
      undefined,
      undefined,
      prepare,
    )
  return {
    root,
    store,
    sources,
    item,
    write,
    placements,
    review,
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

async function approveAndPrepare(review: OutboxReview, item: OutboxRecord, reply = REPLY) {
  const ready = await review.approve(item.id, item.revision, reply, false)
  return review.completeFollowups(ready.id)
}

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

test('Approving a reply creates a separate, linked follow-up from the final edited wording', async () => {
  const f = await fixture()
  try {
    let approvedReply = ''
    const review = f.review(async ({ reply }) => {
      approvedReply = reply
      return [proposal]
    })
    const parent = await approveAndPrepare(review, f.item)
    const child = (await f.store.list()).find((record) => record.origin === 'followup')!
    assert({
      given: 'the owner changes the named colleague before approving the reply',
      should: 'queue the new recipient’s actual draft with its origin, without using the parent’s native destination',
      actual: [
        approvedReply,
        parent.status,
        parent.delivery,
        f.placements.length,
        child.recipient,
        child.draft,
        child.status,
        child.conversation.target,
        child.conversation.sources,
        child.followupOf?.id,
        child.followupOf?.reply,
      ],
      expected: [
        REPLY,
        'ready',
        undefined,
        1,
        proposal.recipient,
        proposal.draft,
        'needs_review',
        null,
        [],
        f.item.id,
        REPLY,
      ],
    })
    const edited = await review.save(child.id, child.revision, 'My edited follow-up.')
    await Promise.all([queueFollowups(f.store, parent), queueFollowups(f.store, parent)])
    assert({
      given: 'repeated recovery after the owner edits the follow-up',
      should: 'reuse the same item and leave the owner’s words intact',
      actual: [(await f.store.list()).length, (await f.store.get(child.id))?.revision, f.placements.length],
      expected: [2, edited.revision, 1],
    })
  } finally {
    await f.clean()
  }
})

test('A reply with no communication commitment creates no follow-up', async () => {
  const f = await fixture()
  try {
    let finalText = ''
    await approveAndPrepare(
      f.review(async ({ reply }) => {
        finalText = reply
        return []
      }),
      f.item,
      'Thanks, I’ll read the document.',
    )
    assert({
      given: 'the owner removes the earlier delegation and commits only to reading',
      should: 'analyze the final reply and leave just the original native draft',
      actual: [finalText, (await f.store.list()).length, f.placements.length],
      expected: ['Thanks, I’ll read the document.', 1, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Follow-up recovery survives a partial write without repeating a native placement', async () => {
  const f = await fixture()
  try {
    const second = {
      ...proposal,
      recipient: 'Taylor Example',
      commitment: 'I’ll tell Taylor Example too.',
      title: 'Tell Taylor',
      draft: 'Taylor, the update will be shared in the channel.',
    }
    const put = f.store.put.bind(f.store)
    let fail = true
    f.store.put = async (item, revision) => {
      if (item.recipient === second.recipient && fail) throw new Error('Temporary disk failure')
      return put(item, revision)
    }
    const parent = await approveAndPrepare(
      f.review(async () => [proposal, second]),
      f.item,
      `${REPLY} ${second.commitment}`,
    )
    assert({
      given: 'the native draft succeeds but the second local follow-up write fails',
      should: 'retain the confirmed native result and a separate recoverable follow-up error',
      actual: [parent.status, parent.native?.id, parent.followupError, (await f.store.list()).length],
      expected: ['ready', 'native-draft', 'Temporary disk failure', 2],
    })
    fail = false
    const reopened = new OutboxStore(f.store.dir, f.store.stateDir)
    const recovered = await reconcileFollowups(reopened, (await reopened.get(parent.id))!)
    await reconcileFollowups(reopened, recovered)
    assert({
      given: 'the next read after a service restart',
      should: 'recover exactly the missing item and clear the error without another model or native write',
      actual: [recovered.followupError, (await reopened.list()).length, f.placements.length],
      expected: [undefined, 3, 1],
    })
  } finally {
    await f.clean()
  }
})

test('An uncertain native placement does not release the follow-up', async () => {
  const f = await fixture()
  try {
    const parent = await f.review(undefined, true).approve(f.item.id, f.item.revision, REPLY, false)
    await reconcileFollowups(f.store, parent)
    assert({
      given: 'the native app did not confirm the original draft',
      should: 'retain the approved context without starting follow-up drafting or creating another review item',
      actual: [parent.status, parent.followups, parent.followupContext?.reply, (await f.store.list()).length],
      expected: ['placement_unknown', undefined, REPLY, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Recovery uses the approved snapshot even after the parent receives new context and an unapproved edit', async () => {
  const f = await fixture()
  try {
    const put = f.store.put.bind(f.store)
    f.store.put = async (item, revision) => {
      if (item.origin === 'followup') throw new Error('Temporary disk failure')
      return put(item, revision)
    }
    const parent = await approveAndPrepare(f.review(), f.item)
    f.store.put = put
    const newer = await f.store.put(
      {
        ...parent,
        stale: true,
        draft: 'An unapproved revision with a different next step.',
        conversation: { ...parent.conversation, version: 'new-capture-version' },
      },
      parent.revision,
    )
    await reconcileFollowups(f.store, newer)
    const child = (await f.store.list()).find((item) => item.origin === 'followup')!
    assert({
      given: 'follow-up persistence resumes after a new capture and an unapproved revision',
      should: 'retain the actual approved reply and its source version',
      actual: [child.followupOf?.reply, child.followupOf?.sourceVersion],
      expected: [REPLY, f.item.conversation.version],
    })
  } finally {
    await f.clean()
  }
})

test('A follow-up can be revised locally with its own recipient and approved parent context', async () => {
  const f = await fixture()
  try {
    await approveAndPrepare(f.review(), f.item)
    const child = (await f.store.list()).find((item) => item.origin === 'followup')!
    let context: unknown
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        throw new Error('Revision must not place a draft')
      },
      () => NOW,
      undefined,
      undefined,
      async (input) => {
        context = [input.item.recipient, input.item.followupOf?.reply, input.draft, input.instruction]
        return {
          action: 'draft',
          title: child.title,
          situation: child.situation,
          reasoning: child.reasoning,
          questions: [],
          draft: 'Casey, please post the update in the shared channel.',
        }
      },
    )
    const result = await review.compose(child.id, child.revision, 'My working follow-up.', 'Shorter.')
    assert({
      given: 'the proactive item has no captured conversation of its own',
      should:
        'revise its working text with the recipient and approved commitment instead of reading the parent as its destination',
      actual: [context, result.draft, f.placements.length],
      expected: [
        [proposal.recipient, REPLY, 'My working follow-up.', 'Shorter.'],
        'Casey, please post the update in the shared channel.',
        1,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Changes after native handoff preserve the approved follow-up context and newer edits', async () => {
  for (const change of ['editor', 'source']) {
    const f = await fixture()
    try {
      const review = f.review(async () => {
        if (change === 'editor') {
          const current = (await f.store.get(f.item.id))!
          await f.store.put({ ...current, draft: 'A newer human edit.', edited: true, stale: true }, current.revision)
        } else await f.write('The update is already shared; no action needed.')
        return [proposal]
      })
      const result = await approveAndPrepare(review, f.item)
      const child = (await f.store.list()).find((item) => item.origin === 'followup')!
      assert({
        given: `${change} changes after the native reply was saved`,
        should: 'retain the newer edit and base the follow-up on the actually approved reply',
        actual: [f.placements.length, child.followupOf?.reply, result.draft],
        expected: [1, REPLY, change === 'editor' ? 'A newer human edit.' : REPLY],
      })
    } finally {
      await f.clean()
    }
  }
})

test('Invalid follow-up output leaves the native draft saved and can retry without repeating placement', async () => {
  const f = await fixture()
  try {
    let calls = 0
    const review = f.review(async () =>
      ++calls === 1 ? [{ ...proposal, commitment: 'A promise that was never made.' }] : [proposal],
    )
    const result = await approveAndPrepare(review, f.item)
    assert({
      given: 'the model invents a follow-up absent from the selected wording',
      should: 'preserve the confirmed native draft and report a separate follow-up failure',
      actual: [
        result.status,
        result.followupStatus,
        Boolean(result.followupError),
        f.placements.length,
        (await f.store.list()).length,
      ],
      expected: ['ready', 'failed', true, 1, 1],
    })
    await review.completeFollowups(result.id)
    assert({
      given: 'a status read after model failure',
      should: 'not repeat the failed model call automatically',
      actual: calls,
      expected: 1,
    })
    await review.retryFollowups(result.id, result.revision)
    const recovered = await review.completeFollowups(result.id)
    assert({
      given: 'an explicit follow-up retry',
      should: 'create the missing item with no second native write',
      actual: [
        recovered.followupStatus,
        recovered.followupError,
        calls,
        f.placements.length,
        (await f.store.list()).length,
      ],
      expected: ['complete', undefined, 2, 1, 2],
    })
  } finally {
    await f.clean()
  }
})

test('Native approval returns before follow-up analysis and overlapping workers do not duplicate it', async () => {
  const f = await fixture()
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let run: Promise<OutboxRecord> | undefined
  try {
    let calls = 0
    const review = f.review(async () => {
      calls++
      started()
      await waiting
      return [proposal]
    })
    const ready = await review.approve(f.item.id, f.item.revision, REPLY, false)
    assert({
      given: 'approval of an unchanged captured conversation',
      should: 'confirm the native handoff with the follow-up still pending',
      actual: [ready.status, ready.followupStatus, calls, f.placements.length],
      expected: ['ready', 'pending', 0, 1],
    })
    run = review.completeFollowups(ready.id)
    await entered
    const error = await errorOf(() => review.completeFollowups(ready.id))
    assert({
      given: 'another worker while the first is thinking',
      should: 'keep one model call',
      actual: [Boolean(error), calls],
      expected: [true, 1],
    })
    release()
    await run
    await review.completeFollowups(ready.id)
    assert({
      given: 'completion followed by another status read',
      should: 'keep one child and one native draft',
      actual: [(await f.store.list()).length, calls, f.placements.length],
      expected: [2, 1, 1],
    })
  } finally {
    release()
    await run?.catch(() => {})
    await f.clean()
  }
})

test('Follow-up grounding accepts typography changes while retaining the original approved quote', async () => {
  const f = await fixture()
  try {
    const review = f.review(async () => [
      { ...proposal, commitment: REPLY.replace('I’ll', "I'll").replace('weekly update', 'weekly\nupdate') },
    ])
    const result = await approveAndPrepare(review, f.item)
    assert({
      given: 'a copied quote with a straight apostrophe and a line wrap',
      should: 'match the same words and store the actual source text',
      actual: [result.followupError, result.followups?.[0].commitment, f.placements.length],
      expected: [undefined, REPLY, 1],
    })
  } finally {
    await f.clean()
  }
})

test('A manually sent message can create its follow-up, with repeat reports remaining idempotent', async () => {
  const f = await fixture()
  try {
    let calls = 0
    const review = f.review(async () => {
      calls++
      return [proposal]
    })
    const saved = await review.save(f.item.id, f.item.revision, REPLY)
    const sent = await review.reportSent(saved.id, saved.revision, 'Sent in the Slack conversation just now.')
    await review.reportSent(saved.id, saved.revision, 'Sent in the Slack conversation just now.')
    assert({
      given: 'the owner sends a saved reply manually and reports it twice',
      should: 'record the evidence, archive the original, and create one follow-up without native writes',
      actual: [sent.status, sent.delivery?.kind, (await f.store.list()).length, calls, f.placements.length],
      expected: ['dismissed', 'owner_report', 2, 1, 0],
    })
  } finally {
    await f.clean()
  }
})

test('The follow-up model adapter receives the exact approved reply and communication preferences', async () => {
  const f = await fixture()
  try {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ followups: [proposal] }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    })
    const result = await createFollowupPlanner(() => ({ model }))({
      item: f.item,
      reply: REPLY,
      preferences: 'Be direct and brief.',
    })
    const user = model.doGenerateCalls[0].prompt.find((message) => message.role === 'user')!
    const input = JSON.parse(
      user.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    )
    assert({
      given: 'the original proposed reply names a different colleague',
      should: 'supply only the final approved wording as the commitment source and retain the generated message',
      actual: [input.approvedReply, input.preferences, input.originalDraft, result[0].draft],
      expected: [REPLY, 'Be direct and brief.', undefined, proposal.draft],
    })
  } finally {
    await f.clean()
  }
})
