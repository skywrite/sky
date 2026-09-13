import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import { createFollowupPlanner } from './followups.ts'
import { conversationChunks, HISTORY_SOURCE_CHARS, prepareConversationHistory } from './history.ts'
import { dayRange } from './range.ts'
import { createReplyComposer, createTriage } from './triage.ts'
import type { Conversation, OutboxRecord } from './types.ts'

const NOW = '2025-03-15 12:00'
const OLD_REF = '2025-03-14/actions/messages/slack_Atlas.md'
const REF = '2025-03-15/actions/messages/slack_Atlas.md'
const ANSWER = '## 2025-03-14 10:00 - **Alex Example**\nThe updated scope is approved.'
const REQUEST = '## 2025-03-14 09:00 - **Jane Doe**\nCan you approve the updated scope?'
const source = (ref: string, body: string) => ({ ref, body, hash: 'v1', from: 'Jane Doe', to: 'Alex Example' })
const longConversation = (): Conversation => ({
  key: 'sample',
  version: 'v1',
  medium: 'Slack',
  target: null,
  limitations: [],
  sources: [
    source(REF, '## 2025-03-15 11:00 - **Jane Doe**\nThanks for confirming.'),
    // Earlier activity was filed later. Chronology must follow the message.
    source('2025-03-16/actions/messages/slack_Atlas.md', `${REQUEST}\n\n${ANSWER}`),
    source(OLD_REF, '## 2025-03-14 11:00 - **Jane Doe**\n' + 'Background details. '.repeat(12_000)),
  ],
})

function mockModel(reply: (input: any) => unknown | Promise<unknown>) {
  const requests: any[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const user = prompt.find((message) => message.role === 'user')!
      const input = JSON.parse(
        user.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      )
      requests.push(input)
      const object = await reply(input)
      return {
        content: [{ type: 'text', text: JSON.stringify(object) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  return { requests, resolve: () => ({ model, maxRetries: 0 }) }
}

function readPart(input: any) {
  const answer = input.conversation.sources.find((part: { body: string }) => part.body.includes(ANSWER))
  return {
    notes: answer
      ? 'Jane requested approval; Alex approved the updated scope at 10:00 on 2025-03-14.'
      : input.previous.notes,
    evidence: answer ? [{ ref: answer.ref, quote: ANSWER }] : input.previous.evidence,
  }
}

test('History chunks preserve every source character, message chronology and a serialized input bound', () => {
  const conversation = longConversation()
  conversation.sources.push(
    source(
      '2025-03-13/actions/messages/slack_Notes.md',
      '# Context\r\n\r\n## Conversation\r\n\r\n### 2025-03-13 08:00 - **Jane Doe**\r\n' +
        'Unicode 🪁 and escaped text "\\\u0001".\r\n'.repeat(6000) +
        '\r\n## Attachments\r\n\r\n### 2025-03-20 09:00 - **A file title**\r\nAttachment context.',
    ),
  )
  const original = structuredClone(conversation)
  const chunks = conversationChunks(conversation)
  const parts = chunks.flat()
  assert({
    given: 'large captures with mixed Slack layouts, attachments, Unicode, escaping and a later filing date',
    should: 'read every character once in bounded excerpts without changing the canonical conversation',
    actual: [
      chunks.length > 1,
      chunks.every((chunk) => chunk.length && JSON.stringify(chunk).length <= HISTORY_SOURCE_CHARS),
      conversation.sources.every((entry) => {
        const slices = parts.filter(({ ref }) => ref === entry.ref).sort((a, b) => a.span.start - b.span.start)
        return slices.map(({ body }) => body).join('') === entry.body && slices.every(({ body }) => body.isWellFormed())
      }),
      parts.every((part, index) => index === 0 || parts[index - 1].times![0] <= part.times![0]),
      parts.some((part) => part.body.includes('Attachment context.')),
      conversation,
    ],
    expected: [true, true, true, true, true, original],
  })
})

test('Large email captures keep preambles, complete messages and the tail across chunk boundaries', () => {
  const conversation = longConversation()
  conversation.medium = 'Email'
  conversation.sources = [
    source(
      '2025-03-15/actions/messages/email_Atlas.md',
      'Thread preamble.\n\n' + REQUEST + '\n' + 'Mail context. '.repeat(20_000) + '\n\n' + ANSWER,
    ),
  ]
  const chunks = conversationChunks(conversation)
  assert({
    given: 'one email capture larger than the former per-file limit',
    should: 'retain the entire body and keep the short final reply intact',
    actual: [
      chunks.length > 1,
      chunks
        .flat()
        .map(({ body }) => body)
        .join(''),
      chunks.at(-1)!.some(({ body }) => body.includes(ANSWER)),
    ],
    expected: [true, conversation.sources[0].body, true],
  })
})

test('Long-history triage carries an early resolution through every pass before one final judgment', async () => {
  const conversation = longConversation()
  const chunks = conversationChunks(conversation)
  const range = dayRange('2025-03-14')
  let writes = 0
  const model = mockModel((input) =>
    input.part
      ? readPart(input)
      : {
          action: 'ignore',
          title: 'Scope already approved',
          situation: 'Alex approved the updated scope.',
          explanation: 'The captured owner reply resolves the selected request.',
          questions: [],
          recommendation: '',
          replyOptions: [],
          draft: '',
          responseEvidence: input.history.evidence[0],
        },
  )
  const result = await createTriage('I am Alex Example.', model.resolve, async () => {
    writes++
    return { draft: 'Unnecessary reply.', rulesRevision: 'v1' }
  })({ conversation, today: '2025-03-15', now: NOW, range, triggerSources: [OLD_REF], preferences: '', examples: [] })
  const final = model.requests.at(-1)
  assert({
    given: 'an approval near the beginning and many later chunks of background context',
    should: 'retain the exact evidence and selected range, read all chunks, then quietly resolve the conversation',
    actual: [
      model.requests.length,
      model.requests.every((input) => JSON.stringify(input.conversation.sources).length <= HISTORY_SOURCE_CHARS),
      model.requests.flatMap((input) => input.conversation.sources),
      final.history.summarizedParts,
      final.searchRange.start,
      final.history.notes.includes('approved'),
      result.action,
      result.responseEvidence,
      writes,
    ],
    expected: [
      chunks.length,
      true,
      chunks.flat(),
      chunks.length - 1,
      range.start,
      true,
      'ignore',
      { ref: '2025-03-16/actions/messages/slack_Atlas.md', quote: ANSWER },
      0,
    ],
  })
})

test('An invalid history citation or failed intermediate pass prevents a final judgment', async () => {
  const outcomes: [boolean, number, boolean][] = []
  for (const mode of ['citation', 'failure']) {
    const model = mockModel((input) => {
      if (mode === 'citation')
        return { notes: 'A supposed answer.', evidence: [{ ref: OLD_REF, quote: 'Invented reply.' }] }
      if (input.part === 2) throw new Error('History model unavailable.')
      return readPart(input)
    })
    let error = ''
    try {
      await prepareConversationHistory(longConversation(), {}, model.resolve)
    } catch (caught) {
      error = (caught as Error).message
    }
    outcomes.push([Boolean(error), model.requests.length, model.requests.every((input) => Boolean(input.part))])
  }
  assert({
    given: 'fabricated evidence or an interrupted reading pass',
    should: 'fail before drafting rather than treating partial reading as complete',
    actual: outcomes,
    expected: [
      [true, 1, true],
      [true, 2, true],
    ],
  })
})

test('Composition and follow-ups also bound long history while preserving the owner direction', async () => {
  const conversation = longConversation()
  const item: OutboxRecord = {
    id: 'a'.repeat(32),
    revision: 'v1',
    created: NOW,
    updated: NOW,
    status: 'needs_review',
    conversation,
    title: 'Confirm the scope',
    situation: 'Jane asked about the scope.',
    reasoning: 'Confirm the approved scope.',
    questions: [],
    originalDraft: 'The scope is approved.',
    draft: 'The scope is approved.',
    edited: false,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
  }
  const model = mockModel((input) => {
    if (input.part) return readPart(input)
    if (input.approvedReply) return { followups: [] }
    return {
      action: 'draft',
      title: item.title,
      situation: item.situation,
      explanation: 'Applied the owner direction.',
      questions: [],
      recommendation: '',
      replyOptions: [],
      draft: 'Approved.',
    }
  })
  let writes = 0
  const composed = await createReplyComposer('', model.resolve, async ({ meaning }) => {
    writes++
    return { draft: meaning, rulesRevision: 'v1' }
  })({ item, draft: item.draft, instruction: 'Make it shorter.', preferences: '', examples: [] })
  const followups = await createFollowupPlanner(model.resolve)({ item, reply: 'Approved.', preferences: '' })
  const final = model.requests.filter((input) => !input.part)
  assert({
    given: 'a reply and approved wording backed by a large saved history',
    should: 'bound both paths and apply the direction only after the history has been read',
    actual: [
      composed.draft,
      followups,
      writes,
      final.length,
      final[0].ownerInstruction,
      final[1].approvedReply,
      model.requests.every((input) => JSON.stringify(input.conversation.sources).length <= HISTORY_SOURCE_CHARS),
    ],
    expected: ['Approved.', [], 1, 2, 'Make it shorter.', 'Approved.', true],
  })
})
