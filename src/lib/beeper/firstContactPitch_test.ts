import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import {
  createFirstContactPitchScreen,
  holdsFirstContactPitches,
  type FirstContactPitchInput,
} from './firstContactPitch.ts'

const input: FirstContactPitchInput = {
  account: 'telegram',
  chat: 'pitch',
  network: 'Telegram',
  sender: 'Alex Example',
  owner: 'Jane Doe',
  historyComplete: true,
  messages: [
    {
      id: 'm1',
      chatID: 'pitch',
      accountID: 'telegram',
      senderID: 'alex',
      timestamp: '2026-03-11T09:00:00Z',
      sortKey: '1',
      isSender: false,
      text: 'We have not met. I sell advertising services. Can I pitch you our Atlas package?',
    },
  ],
}

function answer(firstContact = 0.99, pitch = 0.99, uncertainty = 0.01) {
  return {
    model: 'jev-test',
    answers: {
      first_contact: { type: 'noul', noul: firstContact },
      unsolicited_pitch: { type: 'noul', noul: pitch },
      uncertain_context: { type: 'noul', noul: uncertainty },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  }
}

function fixture(signal?: AbortSignal) {
  const calls: { state: { messages: { text: string }[] }; questions: unknown }[] = []
  const usage: AIUsageRecord[] = []
  const control = { response: () => Response.json(answer()) }
  const client = createTypeSafeClient({
    secrets: new TestSecretsProvider({ 'typesafe/main': createSecret('synthetic-key') }),
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return control.response()
    }) as typeof fetch,
  })
  return {
    calls,
    usage,
    control,
    client,
    screen: createFirstContactPitchScreen({
      client,
      signal,
      sink: (record) => {
        usage.push(record)
      },
    }),
  }
}

test('first-time pitches require both judgments with little uncertainty', async () => {
  const f = fixture()
  const results: boolean[] = []
  for (const scores of [
    [0.99, 0.99, 0.01],
    [0.89, 0.99, 0.01],
    [0.99, 0.89, 0.01],
    [0.99, 0.99, 0.31],
    [0.9, 0.9, 0.3],
  ]) {
    f.control.response = () => Response.json(answer(...scores))
    results.push((await f.screen(input)).hold)
  }
  assert({
    given: 'a clear pitch, uncertain first contact, a greeting, ambiguous context, and the exact cutoffs',
    should: 'hold only high-confidence conjunctions and record usage',
    actual: [results, f.usage.map((row) => row.provider), f.calls[0].state.messages[0].text],
    expected: [[true, false, false, false, true], Array(5).fill('typesafe'), input.messages[0].text],
  })
})

test('first-contact screening never decides from partial history or unclear speakers', async () => {
  const f = fixture()
  const results = await Promise.all([
    f.screen({ ...input, historyComplete: false }),
    f.screen({ ...input, messages: [{ ...input.messages[0], isSender: undefined }] }),
    f.screen({ ...input, messages: [...input.messages, { ...input.messages[0], id: 'reply', isSender: true }] }),
    f.screen({ ...input, messages: [{ ...input.messages[0], text: 'x'.repeat(25_000) }] }),
    f.screen({ ...input, messages: [] }),
  ])
  assert({
    given: 'incomplete history, unknown speaker direction, an owner reply, oversized input, or an empty chat',
    should: 'leave messages visible without asking Jev to guess',
    actual: [results.map((result) => result.hold), f.calls.length],
    expected: [[false, false, false, false, false], 0],
  })
})

test('pitch receipts avoid repeat model calls and expire when evidence or model changes', async () => {
  const f = fixture()
  const first = await f.screen(input)
  const cached = await f.screen(input, first.receipt)
  const callsAfterCache = f.calls.length
  const revised = {
    ...input,
    messages: [{ ...input.messages[0], text: 'Following up on the proposal you asked for.' }],
  }
  const changed = await f.screen(revised, first.receipt)
  const otherModel = createFirstContactPitchScreen({
    client: {
      ...f.client,
      defaultModel: 'different-model',
      systemOne: f.client.systemOne.bind(f.client),
    } as typeof f.client,
    sink: () => {},
  })
  await otherModel(input, first.receipt)
  assert({
    given: 'the same evidence, edited text under the same message id, and a new model release',
    should: 'reuse only the identical request receipt',
    actual: [cached, callsAfterCache, changed.receipt?.key !== first.receipt?.key, f.calls.length],
    expected: [first, 1, true, 3],
  })
})

test('unavailable and malformed pitch judgments cannot hide messages or repeat delays', async () => {
  for (const kind of ['outage', 'invalid'] as const) {
    const f = fixture()
    f.control.response = () => {
      if (kind === 'outage') throw new Error('Synthetic provider outage')
      return Response.json(answer(1.5))
    }
    const first = await f.screen(input)
    const second = await f.screen(input)
    assert({
      given: kind,
      should: 'let both through, explain the fallback, and contact the provider only once per run',
      actual: [first.hold, second.hold, Boolean(first.note?.includes('Settings')), f.calls.length],
      expected: [false, false, true, 1],
    })
  }
})

test('Telegram screening defaults independently of capture and respects an explicit off choice', () => {
  assert({
    given: 'old Telegram rules, another network, and explicit choices',
    should: 'default screening on only for Telegram and honor switches',
    actual: [
      holdsFirstContactPitches({ network: 'Telegram' }),
      holdsFirstContactPitches({ network: 'Signal' }),
      holdsFirstContactPitches({ network: 'Telegram', holdPitches: false }),
      holdsFirstContactPitches({ network: 'Signal', holdPitches: true }),
    ],
    expected: [true, false, false, true],
  })
})

test('cancelled pitch checks propagate cancellation', async () => {
  const controller = new AbortController()
  const f = fixture(controller.signal)
  controller.abort(new Error('Synthetic cancellation'))
  let message = ''
  try {
    await f.screen(input)
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a cancelled sync',
    should: 'stop rather than record a negative judgment',
    actual: [message, f.calls.length],
    expected: ['Synthetic cancellation', 0],
  })
})
