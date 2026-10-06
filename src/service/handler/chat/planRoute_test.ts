import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { assert, test } from '#test'
import { createChatRoutes } from './mod.ts'
import { planMessage, planTestHost, samplePlan } from './planTestHelpers.ts'

const pauseRequest = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"pause"}' }
const until = async (ready: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Test condition did not arrive')
}

test('asking about paused work leaves its persisted plan untouched', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-plan-question-'))
  let turns = 0
  const app = createChatRoutes(
    planTestHost(root, async (plan, { sink }) => {
      turns++
      if (turns === 1) await plan.update(samplePlan())
      sink.write(turns === 1 ? 'The example collection is paused.' : 'The example collection still has work remaining.')
    }),
  )
  try {
    await (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    const before = await (await app.request('/example')).json()
    await (await app.request('/example/messages', planMessage('Why is this paused?'))).text()
    const after = await (await app.request('/example')).json()
    const saved = await loadResumeSession(path.join(root, 'example.md'))
    assert({
      given: 'a status question in a chat with a paused checklist',
      should: 'answer without starting or rewriting the plan, including after recovery',
      actual: [after.plan, saved.recovery?.host?.plan, turns],
      expected: [before.plan, before.plan, 2],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a live plan queues instructions, delivers them without the page, and saves its recovery state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-plan-route-'))
  let release!: () => void
  let calls = 0
  const received: string[] = []
  const app = createChatRoutes(
    planTestHost(root, async (plan, { sink, messages }) => {
      calls++
      received.push(JSON.stringify(messages))
      if (!plan.plan) await plan.update(samplePlan())
      if (calls === 1)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      sink.write('The current result is saved.')
    }),
  )
  try {
    const response = await app.request('/example/messages', planMessage('Collect the example documents.'))
    const stream = response.text()
    await until(async () => !!release)
    const queued = await app.request(
      '/example/messages',
      planMessage('Use the Atlas example folder.', { queue: true, instructionId: 'example-instruction' }),
    )
    const before = await (await app.request('/example')).json()
    const disk = await loadResumeSession(path.join(root, 'example.md'))
    assert({
      given: 'an instruction while work runs',
      should: 'accept and persist it without overlapping the current turn',
      actual: [queued.status, calls, before.queued.length, disk.recovery?.host?.queued],
      expected: [202, 1, 1, [{ id: 'example-instruction', message: 'Use the Atlas example folder.' }]],
    })
    release()
    await stream
    await until(async () => {
      const state = await (await app.request('/example')).json()
      return calls === 2 && !state.busy
    })
    const after = await (await app.request('/example')).json()
    const again = await app.request(
      '/example/messages',
      planMessage('Use the Atlas example folder.', { queue: true, instructionId: 'example-instruction' }),
    )
    assert({
      given: 'a finished tool and a repeated delivery request',
      should: 'deliver once, retain the plan, and pause explicitly when work remains',
      actual: [
        received[1]!.includes('Use the Atlas example folder.'),
        calls,
        after.plan.status,
        after.queued.length,
        again.status,
      ],
      expected: [true, 2, 'paused', 0, 202],
    })
  } finally {
    release?.()
    await rm(root, { recursive: true, force: true })
  }
})

test('pause retains queued work across a disk restore, and resume uses the same plan', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-plan-recovery-'))
  let started = false
  const app = createChatRoutes(
    planTestHost(root, async (plan, { abortSignal }) => {
      await plan.update(samplePlan())
      started = true
      await new Promise<void>((resolve) => abortSignal!.addEventListener('abort', () => resolve(), { once: true }))
    }),
  )
  try {
    const running = (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    await until(async () => started)
    await app.request(
      '/example/messages',
      planMessage('Check duplicates first.', { queue: true, instructionId: 'duplicate-check' }),
    )
    await app.request('/example/plan', pauseRequest)
    await running
    const disk = await loadResumeSession(path.join(root, 'example.md'))
    let resumed = 0
    const recovered = createChatRoutes(
      planTestHost(
        root,
        async (_plan, { sink }) => {
          resumed++
          sink.write('Checked the previous action first.')
        },
        async () => [
          {
            id: 'example',
            state: disk.state,
            plan: disk.recovery?.host?.plan,
            queued: disk.recovery?.host?.queued,
            prefs: { profile: 'test', contextTokens: 0, saves: false },
          },
        ],
      ),
    )
    const read = await (await recovered.request('/example')).json()
    assert({
      given: 'a restart after pausing',
      should: 'retain the checklist and queued instruction without running it',
      actual: [read.plan.title, read.plan.status, read.queued[0].message, resumed],
      expected: ['Collect example documents', 'paused', 'Check duplicates first.', 0],
    })
    const result = await recovered.request('/example/plan', { ...pauseRequest, body: '{"action":"resume"}' })
    await until(async () => resumed === 1 && !(await (await recovered.request('/example')).json()).busy)
    assert({
      given: 'an explicit resume',
      should: 'deliver the waiting instruction in the existing thread',
      actual: [result.status, resumed, (await (await recovered.request('/example')).json()).plan.title],
      expected: [200, 1, 'Collect example documents'],
    })
  } finally {
    await app.request('/example/stop', { method: 'POST' })
    await rm(root, { recursive: true, force: true })
  }
})

test('branches start without a live plan and unwinding later progress clears its claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-plan-branch-'))
  let calls = 0
  const app = createChatRoutes(
    planTestHost(root, async (plan, { sink }) => {
      calls++
      await plan.update(
        { ...samplePlan(), revision: plan.plan?.revision ?? 0, note: `Synthetic progress ${calls}` },
        true,
      )
      sink.write('The example plan is available.')
    }),
  )
  const post = (url: string, body: unknown) =>
    app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    await (await app.request('/example/messages', planMessage('Collect example documents.'))).text()
    const first = await (await app.request('/example')).json()
    const branch = await (await post('/example/branch', first.branchPoints[1])).json()
    const branched = await (await app.request(`/${branch.id}`)).json()
    assert({
      given: 'a branch from a chat with a live checklist',
      should: 'inherit conversation without starting another copy of its work',
      actual: [branched.plan, branched.queued, branched.busy],
      expected: [null, [], false],
    })
    await (await app.request('/example/messages', planMessage('Adjust the example sources.'))).text()
    const cut = await post('/example/unwind', first.branchPoints[1])
    const after = await (await app.request('/example')).json()
    assert({
      given: 'deletion of messages behind later progress',
      should: 'clear their checklist claims and queued work',
      actual: [cut.status, after.plan, after.queued, after.turns.length],
      expected: [200, null, [], 2],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
