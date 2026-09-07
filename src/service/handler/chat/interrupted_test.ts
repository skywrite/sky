import type { ResumeState } from '#shared/models/Chat/document/resume.ts'
import { assert, test } from '#test'
import { interruptedOf } from './interrupted.ts'

const state = (conversation: ResumeState['conversation']): ResumeState => ({
  conversation,
  universePaths: [],
  queries: [],
  lastTurn: conversation.length > 1 ? 1 : 0,
  contextLog: [],
})

test({ name: 'interrupted - a conversation ending on the reply restores whole' }, async () => {
  const whole = state([
    { role: 'user', content: 'Plan the demo.', when: '2026-01-27 09:31' },
    { role: 'assistant', content: 'Focus on the demo.', when: '2026-01-27 09:31' },
  ])
  const { state: restored, interrupted } = interruptedOf(whole)
  assert({
    given: 'a snapshot written as a turn ended',
    should: 'keep every message and find nothing interrupted',
    actual: { same: restored === whole, interrupted },
    expected: { same: true, interrupted: null },
  })
})

test({ name: "interrupted - a conversation ending on the person's message sets that message apart" }, async () => {
  const cut = state([
    { role: 'user', content: 'Plan the demo.', when: '2026-01-27 09:31' },
    { role: 'assistant', content: 'Focus on the demo.', when: '2026-01-27 09:31' },
    { role: 'user', content: 'Now the pricing page.', when: '2026-01-27 09:40' },
  ])
  const lone = state([{ role: 'user', content: 'Plan the demo.' }])
  assert({
    given: 'a snapshot written as a turn began, and one whose only message was that turn',
    should:
      'restore the exchanges before it and carry the message with its time, or an empty conversation and the message unstamped',
    actual: [interruptedOf(cut), interruptedOf(lone)].map(({ state: s, interrupted }) => ({
      roles: s.conversation.map((m) => m.role),
      interrupted,
    })),
    expected: [
      { roles: ['user', 'assistant'], interrupted: { message: 'Now the pricing page.', when: '2026-01-27 09:40' } },
      { roles: [], interrupted: { message: 'Plan the demo.', when: null } },
    ],
  })
})

test('interrupted - the pending message leaves model history while earlier tool results remain', async () => {
  const cut = state([
    { role: 'user', content: 'Read the brief.' },
    { role: 'assistant', content: 'Read it.' },
    { role: 'user', content: 'Continue the plan.' },
  ])
  cut.modelMessages = [
    { role: 'user', content: 'Read the brief.' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read_file', input: {} }] },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'read',
          toolName: 'read_file',
          output: { type: 'text', value: 'The budget is 42 credits.' },
        },
      ],
    },
    { role: 'assistant', content: 'Read it.' },
    { role: 'user', content: 'Continue the plan.' },
  ]
  const restored = interruptedOf(cut)
  assert({
    given: 'an interrupted snapshot with a complete tool exchange before the pending user message',
    should: 'remove only the pending message from both histories and preserve every earlier model message',
    actual: {
      conversation: restored.state.conversation,
      messages: restored.state.modelMessages,
      interrupted: restored.interrupted,
    },
    expected: {
      conversation: cut.conversation.slice(0, -1),
      messages: cut.modelMessages.slice(0, -1),
      interrupted: { message: 'Continue the plan.', when: null },
    },
  })
})
