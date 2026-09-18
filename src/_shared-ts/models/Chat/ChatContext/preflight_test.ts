import { TypeSafeClient } from '@typesafe-ai/sdk'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import { assert, test } from '#test'
import { contextPreflight, SKIP_BELOW } from './preflight.ts'

function judge(noul: number) {
  const bodies: Record<string, unknown>[] = []
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    const answer = {
      model: 'jev-1.13.0',
      answers: { needs_notebook: { type: 'noul', noul } },
      usage: { input_tokens: 80, output_tokens: 0 },
    }
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  let tick = 0
  const client = new TypeSafeClient({ apiKey: 'tsk-test', fetch: fetchFn, logLevel: 'off' })
  // The usage record goes to this sink, never to the real usage log.
  const records: AIUsageRecord[] = []
  return {
    bodies,
    records,
    preflight: contextPreflight(client, { now: () => (tick += 45), sink: (r) => void records.push(r) }),
  }
}

const RECENT: ConversationMessage[] = [
  { role: 'user', content: 'What did the Atlas meeting decide?' },
  { role: 'assistant', content: 'x'.repeat(900) },
  { role: 'user', content: 'Who owns the follow-up?' },
  { role: 'assistant', content: 'Jane Doe owns it.' },
]

test('the preflight sends the message with the recent turns trimmed, and reads a low probability as a skip', async () => {
  const low = judge(0.04)
  const verdict = await low.preflight('Make that shorter.', RECENT, { assembled: false })
  const state = low.bodies[0]?.state as { message: string; recent_turns: { who: string; said: string }[] }
  assert({
    given: 'a message with four recent turns, one of them long, and a judge at 4%',
    should: 'send the message and the turns as person/sky with each trimmed, and skip with the timing',
    actual: {
      message: state.message,
      who: state.recent_turns.map((turn) => turn.who),
      trimmed: state.recent_turns.map((turn) => turn.said.length),
      question: Object.keys((low.bodies[0]?.questions as object) ?? {}),
      verdict,
      recorded: low.records.map((r) => [r.provider, r.model, r.input]),
    },
    expected: {
      message: 'Make that shorter.',
      who: ['person', 'sky', 'person', 'sky'],
      trimmed: [34, 400, 23, 17],
      question: ['needs_notebook'],
      verdict: { needsNotebook: 0.04, skipped: true, question: 'needs_notebook', model: 'jev-1.13.0', ms: 45 },
      recorded: [['typesafe', 'jev-1.13.0', 80]],
    },
  })
})

test('the preflight reads anything at or over the line as a turn that reads', async () => {
  const sure = judge(0.91)
  const edge = judge(SKIP_BELOW)
  assert({
    given: 'judges at 91% and exactly on the line',
    should: 'read in both cases',
    actual: [
      (await sure.preflight('What is on my calendar?', [], { assembled: false }))?.skipped,
      (await edge.preflight('Hmm.', [], { assembled: true }))?.skipped,
    ],
    expected: [false, false],
  })
})

test('after a reading, the preflight asks whether the message needs anything more', async () => {
  const before = judge(0.5)
  const after = judge(0.07)
  await before.preflight('What did the Atlas meeting decide?', [], { assembled: false })
  const verdict = await after.preflight('Yep, draft it.', RECENT, { assembled: true })
  const questionOf = (body: Record<string, unknown> | undefined) => {
    const questions = (body?.questions ?? {}) as Record<string, { instructions: string }>
    const [name] = Object.keys(questions)
    return [name, questions[name]?.instructions.includes('anything more from the notebook')]
  }
  assert({
    given: 'a first turn with nothing assembled, then a follow-up after the notebook was read',
    should:
      'ask whether the notebook is needed at all, then whether anything more is needed, and say which on the verdict',
    actual: [questionOf(before.bodies[0]), questionOf(after.bodies[0]), verdict],
    expected: [
      ['needs_notebook', false],
      ['needs_more', true],
      { needsNotebook: 0.07, skipped: true, question: 'needs_more', model: 'jev-1.13.0', ms: 45 },
    ],
  })
})
