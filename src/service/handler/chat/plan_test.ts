import { assert, test } from '#test'
import type { ToolRun } from './mod.ts'
import { ChatPlanController, restorePlan } from './plan.ts'

export const examplePlan = () => ({
  revision: 0,
  title: 'Collect example documents',
  outcome: 'Checked files together in one folder.',
  status: 'working' as const,
  note: '',
  finalCheck: '',
  artifacts: [],
  steps: [
    {
      id: 'collect',
      title: 'Collect documents',
      kind: 'action' as const,
      status: 'pending' as const,
      detail: '',
      evidence: [],
      items: [],
    },
  ],
})

async function refused(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work()
    return false
  } catch {
    return true
  }
}

test('live plans require real results, stable revisions, and an explicit final check', async () => {
  const runs: ToolRun[] = [
    {
      tool: 'read_file',
      callId: 'read-example',
      at: 1,
      started: 1,
      status: 'success',
      lines: [],
      output: { success: true, path: '/tmp/example.pdf' },
    },
  ]
  let saved = 0
  const controller = new ChatPlanController({
    runs: () => runs,
    at: () => 1,
    changed: async () => {
      saved++
    },
  })
  await controller.update(examplePlan())
  const done = {
    ...examplePlan(),
    revision: 1,
    status: 'complete' as const,
    finalCheck: 'Opened and checked the example PDF.',
    steps: [
      {
        ...examplePlan().steps[0]!,
        status: 'done' as const,
        detail: 'The expected document was read.',
        evidence: ['read-example'],
      },
    ],
  }
  assert({
    given: 'a claimed action without evidence, an unfinished checklist, or an invented file',
    should: 'refuse all three without changing the stored revision',
    actual: [
      await refused(() => controller.update({ ...done, steps: [{ ...done.steps[0]!, evidence: ['invented'] }] })),
      await refused(() => controller.update({ ...done, finalCheck: '' })),
      await refused(() =>
        controller.update({
          ...done,
          artifacts: [{ label: 'Wrong file', location: '/tmp/missing.pdf', evidence: 'read-example' }],
        }),
      ),
      controller.plan?.revision,
    ],
    expected: [true, true, true, 1],
  })
  await controller.update({
    ...done,
    artifacts: [{ label: 'Example PDF', location: '/tmp/example.pdf', evidence: 'read-example' }],
  })
  assert({
    given: 'verified results and a final check',
    should: 'save completion and refuse stale updates',
    actual: [controller.plan?.status, saved, await refused(() => controller.update(done))],
    expected: ['complete', 2, true],
  })
})

test('a browser handoff survives read-back but requires a fresh check after interruption', async () => {
  const controller = new ChatPlanController({ runs: () => [], at: () => 1, changed: async () => {} })
  await controller.update(examplePlan())
  const signal = new AbortController()
  const waiting = controller.wait('Finish sign-in on the computer running Sky.', 'browser', signal.signal)
  const held = structuredClone(controller.plan)
  await controller.pause()
  assert({
    given: 'a paused browser handoff',
    should: 'release its waiter and recover as paused without a reusable approval',
    actual: [await waiting, controller.plan?.status, restorePlan(held)?.status, restorePlan(held)?.attention],
    expected: [false, 'paused', 'paused', null],
  })
  await controller.begin()
  const second = controller.wait('Check the account.', 'browser', signal.signal)
  signal.abort()
  assert({
    given: 'an aborted turn',
    should: 'release the handoff without claiming it succeeded',
    actual: await second,
    expected: false,
  })
})

test('queued instructions prevent completion and native sign-in cannot override a pause', async () => {
  const controller = new ChatPlanController({ runs: () => [], at: () => 1, changed: async () => {} })
  await controller.update(examplePlan())
  await controller.enqueue({ id: 'instruction', message: 'Use the example folder.' })
  await controller.enqueue({ id: 'instruction', message: 'Use the example folder.' })
  assert({
    given: 'the same accepted instruction delivered twice',
    should: 'keep one copy and refuse changed content with its key',
    actual: [
      controller.queue.length,
      await refused(() => controller.enqueue({ id: 'instruction', message: 'Different instruction' })),
    ],
    expected: [1, true],
  })
  let release!: () => void
  const native = controller.nativeSignIn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  await Promise.resolve()
  await controller.pause()
  release()
  await native
  assert({
    given: 'native UI finishing after Pause',
    should: 'keep the plan paused',
    actual: controller.plan?.status,
    expected: 'paused',
  })
})

test('an expired sign-in cannot become a browser handoff after its task closes', async () => {
  const controller = new ChatPlanController({ runs: () => [], at: () => 1, changed: async () => {} })
  await controller.update(examplePlan())
  const note = 'The sign-in approval expired. Resume for a fresh attempt.'
  await controller.pause(note)
  const signal = new AbortController()
  const handoff = controller.wait('Check the browser for Atlas.', 'browser', signal.signal)
  signal.abort()
  assert({
    given: 'a browser request after a failed sign-in paused and closed its task',
    should: 'refuse a nonexistent handoff and preserve the reason and Resume control',
    actual: [await refused(() => handoff), controller.plan?.status, controller.plan?.note, controller.plan?.attention],
    expected: [true, 'paused', note, null],
  })

  const readiness = controller.wait('Are you at your Mac and ready to retry?', 'question')
  const kind = controller.plan?.attention?.kind
  controller.answer(controller.plan!.attention!.id)
  assert({
    given: 'a readiness question instead of a claim that a browser is waiting',
    should: 'allow the person to explicitly continue',
    actual: [kind, await readiness],
    expected: ['question', true],
  })
})
