import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { assert, test } from '#test'
import { createChatRoutes } from './mod.ts'
import { planMessage, planTestHost, samplePlan } from './planTestHelpers.ts'

type Work = Parameters<typeof planTestHost>[1]

function queueHost(
  root: string,
  work: (...args: [...Parameters<Work>, yielding: () => boolean]) => Promise<void>,
  snapshots?: Parameters<typeof planTestHost>[2],
) {
  let yielding = () => false
  const host = planTestHost(root, (plan, input) => work(plan, input, yielding), snapshots)
  const create = host.createSession
  host.createSession = async (...args) => {
    const session = await create(...args)
    yielding = () => session.shouldYield?.() ?? false
    return session
  }
  return host
}

async function until(ready: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The queued turn did not settle')
}

const action = (action: string, id?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, id }),
})

test('messages queued during a separate reply run with tools while the plan stays paused', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-paused-conversation-'))
  let release!: () => void
  let calls = 0
  const yields: boolean[] = []
  const received: string[] = []
  const app = createChatRoutes(
    queueHost(root, async (plan, { sink, messages }, yielding) => {
      calls++
      if (calls === 1) await plan.update(samplePlan())
      else {
        yields.push(yielding())
        if (calls === 2) {
          await new Promise<void>((resolve) => (release = resolve))
          yields.push(yielding())
        } else received.push(JSON.stringify(messages.at(-1)))
      }
      sink.write('The requested information is available.')
    }),
  )
  try {
    await (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    const before = await (await app.request('/example')).json()
    const running = (await app.request('/example/messages', planMessage('Read the Atlas document.'))).text()
    await until(async () => !!release)
    await app.request('/example/messages', planMessage('Check Atlas totals.', { queue: true, instructionId: 'totals' }))
    await app.request(
      '/example/messages',
      planMessage('List missing documents.', { queue: true, instructionId: 'missing' }),
    )
    release()
    await running
    await until(async () => calls === 4 && !(await (await app.request('/example')).json()).busy)
    const after = await (await app.request('/example')).json()
    const duplicate = await app.request(
      '/example/messages',
      planMessage('Check Atlas totals.', { queue: true, instructionId: 'totals' }),
    )
    assert({
      given: 'two instructions arrive while answering a question beside an already paused plan',
      should: 'yield once, deliver both in order with tools enabled, and leave the checklist paused',
      actual: [
        yields,
        received.map((text, index) => text.includes(index === 0 ? 'Check Atlas totals.' : 'List missing documents.')),
        before.plan.status,
        after.plan.status,
        after.plan.steps,
        after.queued,
        calls,
        duplicate.status,
      ],
      expected: [[false, true, false, false], [true, true], 'paused', 'paused', before.plan.steps, [], 4, 202],
    })
  } finally {
    release?.()
    await rm(root, { recursive: true, force: true })
  }
})

test('Stop holds pending instructions without blocking new replies or their queued messages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-stopped-instructions-'))
  let started = false
  let release!: () => void
  let calls = 0
  const yields: boolean[] = []
  const received: string[] = []
  const app = createChatRoutes(
    queueHost(root, async (plan, { sink, messages, abortSignal }, yielding) => {
      calls++
      if (calls === 1) {
        await plan.update(samplePlan())
        started = true
        await new Promise<void>((resolve) => abortSignal!.addEventListener('abort', () => resolve(), { once: true }))
      } else {
        yields.push(yielding())
        if (calls === 2) await new Promise<void>((resolve) => (release = resolve))
        else received.push(JSON.stringify(messages.at(-1)))
      }
      sink.write('The requested result is recorded.')
    }),
  )
  try {
    const initial = (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    await until(async () => started)
    await app.request('/example/messages', planMessage('File the documents.', { queue: true, instructionId: 'filing' }))
    await app.request('/example/plan', action('pause'))
    await initial
    const disk = await loadResumeSession(path.join(root, 'example.md'))
    const stopped = await (await app.request('/example')).json()
    assert({
      given: 'Stop while a follow-up waits',
      should: 'retain the instruction on disk without delivering it',
      actual: [calls, stopped.queued[0]?.held, disk.recovery?.host?.queued],
      expected: [1, true, [{ id: 'filing', message: 'File the documents.', held: true }]],
    })
    const later = (await app.request('/example/messages', planMessage('Explain the Atlas document.'))).text()
    await until(async () => !!release)
    await app.request(
      '/example/messages',
      planMessage('Check the example amount.', { queue: true, instructionId: 'amount' }),
    )
    release()
    await later
    await until(async () => calls === 3 && !(await (await app.request('/example')).json()).busy)
    const afterQuestion = await (await app.request('/example')).json()
    const sent = await app.request('/example/plan', action('send-instruction', 'filing'))
    await until(async () => calls === 4 && !(await (await app.request('/example')).json()).busy)
    const afterSend = await (await app.request('/example')).json()
    assert({
      given: 'a new question and instruction arrive after Stop, followed by Send now on the held instruction',
      should:
        'keep tools available, deliver new messages past held work, and send the held one without resuming the plan',
      actual: [
        yields,
        received.map((text, index) => text.includes(index === 0 ? 'Check the example amount.' : 'File the documents.')),
        afterQuestion.queued.map((entry: { id: string; held: boolean }) => [entry.id, entry.held]),
        sent.status,
        afterSend.plan.status,
        afterSend.queued,
      ],
      expected: [[false, false, false], [true, true], [['filing', true]], 200, 'paused', []],
    })
  } finally {
    release?.()
    await app.request('/example/stop', { method: 'POST' })
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy queued instructions recover held and cannot disable tools on a fresh reply', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-queued-recovery-'))
  const original = createChatRoutes(
    planTestHost(root, async (plan, { sink }) => {
      await plan.update(samplePlan())
      sink.write('The example task is paused.')
    }),
  )
  try {
    await (await original.request('/example/messages', planMessage('Collect example documents.'))).text()
    const disk = await loadResumeSession(path.join(root, 'example.md'))
    let calls = 0
    const yields: boolean[] = []
    const recovered = createChatRoutes(
      queueHost(
        root,
        async (_plan, { sink }, yielding) => {
          calls++
          yields.push(yielding())
          sink.write('The requested information is available.')
        },
        async () => [
          {
            id: 'example',
            state: disk.state,
            plan: disk.recovery?.host?.plan,
            queued: [{ id: 'legacy', message: 'Check the Atlas total.' }],
            prefs: { profile: 'test', contextTokens: 0, saves: false },
          },
        ],
      ),
    )
    const before = await (await recovered.request('/example')).json()
    await (await recovered.request('/example/messages', planMessage('Read the example document.'))).text()
    const afterQuestion = await (await recovered.request('/example')).json()
    await recovered.request('/example/plan', action('send-instruction', 'legacy'))
    await until(async () => calls === 2 && !(await (await recovered.request('/example')).json()).busy)
    const afterSend = await (await recovered.request('/example')).json()
    assert({
      given: 'a pre-fix recovery snapshot with an instruction stranded beside a paused plan',
      should: 'allow new tools immediately and offer delivery of the saved message without restarting the task',
      actual: [before.queued[0].held, afterQuestion.queued[0].held, yields, afterSend.queued, afterSend.plan.status],
      expected: [true, true, [false, false], [], 'paused'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a queued message that fails acceptance is held instead of repeatedly retried', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-queue-acceptance-'))
  let release!: () => void
  let calls = 0
  let refused = 0
  let unavailable = false
  const host = queueHost(root, async (plan, { sink }) => {
    calls++
    if (calls === 1) {
      await plan.update(samplePlan())
      await new Promise<void>((resolve) => (release = resolve))
    }
    sink.write('The current result is saved.')
  })
  host.onMessage = () => {
    if (unavailable) {
      refused++
      throw new Error('The host could not accept this message.')
    }
  }
  const app = createChatRoutes(host)
  try {
    const running = (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    await until(async () => !!release)
    await app.request('/example/messages', planMessage('Check totals.', { queue: true, instructionId: 'totals' }))
    unavailable = true
    release()
    await running
    await until(async () => (await (await app.request('/example')).json()).queued[0]?.held)
    unavailable = false
    const blocked = await (await app.request('/example')).json()
    await app.request('/example/plan', action('send-instruction', 'totals'))
    await until(async () => calls === 2 && !(await (await app.request('/example')).json()).busy)
    assert({
      given: 'the host refuses delivery before an accepted instruction can start',
      should: 'stop after one refused delivery and retain the message for a successful explicit retry',
      actual: [
        refused,
        blocked.queued[0].id,
        blocked.plan.status,
        (await (await app.request('/example')).json()).queued,
      ],
      expected: [1, 'totals', 'paused', []],
    })
  } finally {
    release?.()
    await rm(root, { recursive: true, force: true })
  }
})
