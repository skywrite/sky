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
