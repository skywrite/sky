import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { CaptureRequest, CaptureResponse } from '#lib/workstreams/captureTypes.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const preview: CaptureResponse = {
  title: 'Expand the Atlas pilot',
  outcome: 'Bring more customers into the pilot.',
  understanding: 'Two customers are evaluating the pilot.',
  horizon: 'few-weeks',
  horizonLabel: 'A few weeks',
  question: null,
  sources: [{ id: 'context-123', path: 'time/pilot-notes.md', label: 'Pilot notes' }],
  contextLimited: false,
}
async function fixture(capture?: (input: CaptureRequest, signal?: AbortSignal) => Promise<CaptureResponse>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-capture-route-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const app = createWorkstreamRoutes({
    store,
    capture,
    today: () => '2025-03-15',
    automation: async () => null,
    setup: async () => ({}),
    draft: async () => ({}),
    run: async (id) => ({
      id: 'run',
      workstreamId: id,
      status: 'nothing',
      trigger: 'manual',
      started: '2025-03-15 12:00',
      summary: '',
      artifactIds: [],
    }),
    planDay: async (id) => (await store.get(id))!,
  })
  const request = (body: unknown, options: { origin?: string; signal?: AbortSignal; json?: boolean } = {}) =>
    app.request('/capture', {
      method: 'POST',
      headers: {
        ...(options.json === false ? {} : { 'Content-Type': 'application/json' }),
        ...(options.origin ? { Origin: options.origin } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  return { store, app, request, clean: () => rm(root, { recursive: true, force: true }) }
}

test('capture accepts a short conversation and forwards cancellation without creating work', async () => {
  let received: CaptureRequest | undefined
  let aborted = false
  const f = await fixture(async (input, signal) => {
    received = input
    aborted = signal?.aborted ?? false
    return preview
  })
  try {
    const input = {
      intent: '  Expand the Atlas pilot.  ',
      horizon: 'few-weeks',
      answers: [
        { field: 'outcome', question: 'What would success mean?', answer: 'A useful pilot with more customers.' },
      ],
    }
    const result = await f.request(input)
    const normalized = { ...input, intent: input.intent.trim() }
    const controller = new AbortController()
    controller.abort()
    await f.request({ intent: 'Another intention.' }, { signal: controller.signal })
    assert({
      given: 'an intention with one answer and a canceled follow-up request',
      should:
        'return only a starting point, default empty answers, preserve the request signal and create no workstream',
      actual: [result.status, await result.json(), received, aborted, (await f.store.list()).length],
      expected: [200, preview, { intent: 'Another intention.', answers: [] }, true, 0],
    })
    const repeated = await f.request(normalized)
    assert({
      given: 'the same intake conversation submitted again',
      should: 'remain read-only and preserve the complete normalized input',
      actual: [repeated.status, received, (await f.store.report()).items],
      expected: [200, normalized, []],
    })
  } finally {
    await f.clean()
  }
})

test('capture validates origin, JSON, intent, horizons and the question budget before invoking AI', async () => {
  let calls = 0
  const f = await fixture(async () => {
    calls++
    return preview
  })
  try {
    const answer = { field: 'timing', question: 'When?', answer: 'A few weeks' }
    const responses = await Promise.all([
      f.request({ intent: 'Atlas' }, { origin: 'https://example.com' }),
      f.request({ intent: 'Atlas' }, { json: false }),
      f.request({ intent: '  ' }),
      f.request({ intent: 'Atlas', horizon: 'next-year' }),
      f.request({ intent: 'Atlas', answers: [answer, answer, answer, answer] }),
      f.request({ intent: 'Atlas', answers: [{ ...answer, field: 'tasks' }] }),
    ])
    assert({
      given: 'foreign, malformed or oversized conversation requests',
      should: 'reject each request before model work or persisted creation',
      actual: [responses.map((response) => response.status), calls, (await f.store.list()).length],
      expected: [[403, 400, 400, 400, 400, 400], 0, 0],
    })
  } finally {
    await f.clean()
  }
})

test('capture reports provider, timeout, invalid response and unavailable service errors honestly', async () => {
  const failures: unknown[] = [
    new Error('Connect a model account to continue.'),
    new DOMException('Timed out', 'TimeoutError'),
    new DOMException('Canceled', 'AbortError'),
    null,
  ]
  const f = await fixture(async () => {
    const failure = failures.shift()
    if (failure) throw failure
    return { ...preview, title: '' }
  })
  const unavailable = await fixture()
  try {
    const responses: Response[] = []
    for (let i = 0; i < 4; i++) responses.push(await f.request({ intent: 'Atlas' }))
    const missing = await unavailable.request({ intent: 'Atlas' })
    const messages = await Promise.all(responses.map(async (response) => (await response.json()).message as string))
    assert({
      given:
        'a missing model connection, timed out or canceled review, bad model response, and unavailable capture handler',
      should: 'return actionable errors without claiming that work was saved',
      actual: [
        responses.map((response) => response.status),
        messages[0],
        messages.slice(1).every((message) => message.includes('has not been saved')),
        missing.status,
        (await f.store.list()).length,
      ],
      expected: [[503, 503, 503, 503], 'Connect a model account to continue.', true, 503, 0],
    })
  } finally {
    await f.clean()
    await unavailable.clean()
  }
})
