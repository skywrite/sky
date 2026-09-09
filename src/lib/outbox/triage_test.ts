import { MockLanguageModelV4 } from 'ai/test'
import type { VoiceDraftInput, VoiceWriter } from '#lib/writingVoice/types.ts'
import { assert, test } from '#test'
import { createReplyComposer, createTriage } from './triage.ts'
import type { Conversation, DraftProposal, OutboxRecord } from './types.ts'

const TODAY = '2025-03-15'
const conversation: Conversation = {
  key: 'sample',
  version: 'v1',
  medium: 'Slack',
  target: null,
  limitations: [],
  sources: [
    {
      ref: `${TODAY}/actions/messages/slack_Atlas.md`,
      hash: 'v1',
      from: 'Alex Example',
      to: 'Jane Doe',
      body: '## 2025-03-15 09:00 - **Jane Doe**\nCan you clarify that feedback?',
    },
  ],
}
const reply: DraftProposal = {
  action: 'draft',
  title: 'Clarify the pilot feedback',
  situation: 'Jane asked about the pilot feedback.',
  reasoning: 'A concise clarification resolves the question.',
  questions: [],
  recommendation: '',
  replyOptions: [],
  draft: 'I meant the first-run instructions. The rest looks good to me.',
}
const item: OutboxRecord = {
  id: 'a'.repeat(32),
  revision: 'v1',
  created: TODAY,
  updated: TODAY,
  status: 'needs_review',
  conversation,
  title: reply.title,
  situation: reply.situation,
  reasoning: reply.reasoning,
  questions: [],
  originalDraft: reply.draft,
  draft: reply.draft,
  edited: false,
  stale: false,
  reviews: [],
  native: null,
  placementError: null,
}
function modelFor(object: DraftProposal) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(object) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
}
function sentTo(model: MockLanguageModelV4) {
  const user = model.doGenerateCalls[0].prompt.find((message) => message.role === 'user')!
  return JSON.parse(
    user.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join(''),
  )
}

test('Outbox uses the shared writer for new and revised replies while leaving unresolved decisions to the owner', async () => {
  const requests: VoiceDraftInput[] = []
  const write: VoiceWriter = async (input) => {
    requests.push(input)
    return { draft: 'The first-run instructions need work. Everything else looks good.', rulesRevision: 'rules-v2' }
  }
  const model = modelFor(reply)
  const triageInput = {
    conversation,
    today: TODAY,
    now: TODAY,
    preferences: 'Keep it direct.',
    examples: [{ original: 'Old wording.', final: 'An unconfirmed edit.', at: TODAY, sourceVersion: 'old' }],
  }
  const proposed = await createTriage('', () => ({ model }), write)(triageInput)
  const composed = await createReplyComposer(
    '',
    () => ({ model }),
    write,
  )({
    item: { ...item, recipient: 'Jane Doe' },
    draft: 'My unsaved edit.',
    instruction: 'Shorten the introduction.',
    preferences: triageInput.preferences,
    examples: triageInput.examples,
  })
  const decision = await createTriage(
    '',
    () => ({ model: modelFor({ ...reply, action: 'decision', questions: ['Which scope do you prefer?'] }) }),
    write,
  )(triageInput)
  assert({
    given: 'the shared writing agent is connected to Outbox',
    should: 'present its wording, carry the owner’s revision direction, and avoid inventing answers to decisions',
    actual: [
      proposed.draft,
      composed.draft,
      requests.map(({ meaning, medium, instruction, recipient }) => ({ meaning, medium, instruction, recipient })),
      sentTo(model).examples,
      decision.draft,
    ],
    expected: [
      'The first-run instructions need work. Everything else looks good.',
      'The first-run instructions need work. Everything else looks good.',
      [
        { meaning: reply.draft, medium: 'Slack', instruction: undefined, recipient: undefined },
        { meaning: reply.draft, medium: 'Slack', instruction: 'Shorten the introduction.', recipient: 'Jane Doe' },
      ],
      [],
      '',
    ],
  })
})

test('Outbox preserves the model’s proposed reply instead of replacing it with an empty draft', async () => {
  const model = modelFor(reply)
  const result = await createTriage('I am Alex Example.', () => ({ model }))({
    conversation,
    today: TODAY,
    now: `${TODAY} 14:00`,
    preferences: 'Keep it brief.',
    examples: [],
  })
  const input = sentTo(model)
  assert({
    given: 'the SDK produces a grounded draft from a captured conversation',
    should: 'retain the reply and supply the date and actual message body in one call',
    actual: [
      result.draft,
      model.doGenerateCalls.length,
      input.today,
      input.triggerSources,
      input.conversation.sources[0].body,
    ],
    expected: [reply.draft, 1, TODAY, [conversation.sources[0].ref], conversation.sources[0].body],
  })
})

test('Outbox keeps an unresolved choice explicit and strips an inconsistent draft', async () => {
  const choice = {
    ...reply,
    action: 'decision' as const,
    questions: ['Which scope do you prefer?'],
    recommendation: 'Start with the smaller pilot to validate the flow.',
    replyOptions: [
      { label: 'Use the smaller pilot', instruction: 'Choose the smaller pilot scope and explain that briefly.' },
    ],
    draft: 'An unsupported choice must not enter the reply.',
  }
  const model = modelFor(choice)
  const result = await createTriage('', () => ({ model }))({
    conversation,
    today: TODAY,
    now: TODAY,
    preferences: '',
    examples: [],
  })
  assert({
    given: 'a decision still requires an owner choice',
    should: 'offer the choice without pretending the owner made it',
    actual: [result.draft, result.replyOptions, result.questions],
    expected: ['', choice.replyOptions, choice.questions],
  })
})

test('Outbox drafting receives the owner’s direction and working text, with bounded style examples', async () => {
  const model = modelFor(reply)
  const result = await createReplyComposer('I am Alex Example.', () => ({ model }))({
    item,
    draft: 'My unsaved edit.',
    instruction: 'Make it shorter.',
    preferences: 'Keep it direct.',
    examples: Array.from({ length: 12 }, () => ({
      original: 'a'.repeat(40000),
      final: 'b'.repeat(40000),
      at: TODAY,
      sourceVersion: 'old',
    })),
  })
  const input = sentTo(model)
  assert({
    given: 'a user asks Sky to revise an unsaved edit',
    should: 'include that text and direction without loading full reports as examples',
    actual: [
      result.draft,
      input.currentDraft,
      input.ownerInstruction,
      input.ownerContext,
      input.examples.length,
      input.examples[0].original.length,
    ],
    expected: [reply.draft, 'My unsaved edit.', 'Make it shorter.', 'I am Alex Example.', 4, 1500],
  })
})
