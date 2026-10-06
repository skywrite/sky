import { TypeSafeClient } from '@typesafe-ai/sdk'
import { CommandResult } from '#commands/mod.ts'
import { browserTaskHost } from '#lib/browser/task/host.ts'
import { assert, test } from '#test'
import { ChatPlanController } from './plan.ts'
import { samplePlan } from './planTestHelpers.ts'
import { taskAdmission, type TaskIntent } from './taskAdmission.ts'
import { createTaskTools } from './taskTools.ts'

const call = { toolCallId: 'synthetic-call', messages: [], context: {} }
const controller = () => new ChatPlanController({ runs: () => [], at: () => 1, changed: async () => {} })

test('an email question cannot create a checklist or launch a browser even when the main model tries both', async () => {
  let decisions = 0
  let browsers = 0
  const bodies: Array<{ state: { conversation: unknown[] } }> = []
  const client = new TypeSafeClient({
    apiKey: 'test',
    logLevel: 'off',
    fetch: (async (_input, init) => {
      decisions++
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        model: 'test',
        usage: { input_tokens: 50, output_tokens: 0 },
        answers: {
          intent: {
            type: 'choice',
            choice: 'answer',
            confidence: 0.99,
            probabilities: { answer: 0.99, action: 0.005, workflow: 0.004, draft: 0.001 },
          },
          browser: { type: 'noul', noul: 0.01 },
        },
      })
    }) as typeof fetch,
  })
  const conversation = [
    { role: 'user' as const, content: 'What do you think about the Atlas email thread? Do you have all of it?' },
  ]
  const plan = controller()
  const tools = createTaskTools({
    plan,
    admit: taskAdmission(client, conversation, null, { sink: () => {} }),
    runBrowser: async () => {
      browsers++
      return CommandResult.success()
    },
  })
  assert({
    given: 'a normal question before any task tool is called',
    should: 'add no classification request to ordinary chat',
    actual: decisions,
    expected: 0,
  })
  const checklist = await tools.update_plan.execute!(samplePlan(), call)
  const browser = await tools.browser_task.execute!({ objective: 'Open Gmail and search for Atlas.' }, call)
  assert({
    given: 'the model tries to turn email retrieval into a browser workflow',
    should: 'reject both before side effects using one decision about the user’s actual request',
    actual: [checklist, browser].map((result) => (result as { success: boolean }).success),
    expected: [false, false],
  })
  assert({
    given: 'both rejected attempts',
    should: 'leave no plan or browser and preserve the actual request for judging',
    actual: [plan.plan, browsers, decisions, bodies[0]?.state.conversation],
    expected: [null, 0, 1, conversation],
  })
})

test('small browser work runs without a plan and reports a handoff without inventing one', async () => {
  const plan = controller()
  let calls = 0
  const tools = createTaskTools({
    plan,
    admit: async () => ({ kind: 'action', browser: true }),
    runBrowser: async () => {
      calls++
      if (calls === 2)
        await browserTaskHost
          .getStore()!
          .needsYou('Finish the example site’s sign-in in Brave, then ask Sky to continue.')
      return CommandResult.success({ report: 'Opened the requested page.' })
    },
  })
  const opened = (await tools.browser_task.execute!({ objective: 'Open the example page in Brave.' }, call)) as {
    success: boolean
  }
  const blocked = (await tools.browser_task.execute!({ objective: 'Open the example account page.' }, call)) as {
    success: boolean
    error: string
  }
  assert({
    given: 'an explicit small browser task and then a page needing a human',
    should: 'run without a checklist and return the actual handoff instruction',
    actual: [opened.success, blocked.success, blocked.error, calls, plan.plan],
    expected: [true, false, 'Finish the example site’s sign-in in Brave, then ask Sky to continue.', 2, null],
  })
})

test('a requested file adjustment can update existing results while the browser plan stays paused', async () => {
  const destination = '/tmp/example/Done/Atlas/statement.pdf'
  const plan = new ChatPlanController({
    runs: () => [
      {
        tool: 'move_path',
        callId: 'move-example',
        at: 1,
        started: 1,
        status: 'success',
        lines: [],
        output: { success: true, destination },
      },
    ],
    at: () => 1,
    changed: async () => {},
  })
  await plan.update(samplePlan())
  await plan.pause()
  let browsers = 0
  const tools = createTaskTools({
    plan,
    admit: async () => ({ kind: 'action', browser: false }),
    runBrowser: async () => {
      browsers++
      return CommandResult.success()
    },
  })
  const updated = (await tools.update_plan.execute!(
    {
      ...samplePlan(),
      revision: plan.plan!.revision,
      status: 'paused',
      artifacts: [{ label: 'Atlas statement', location: destination, evidence: 'move-example' }],
    },
    call,
  )) as { success: boolean }
  const resumed = (await tools.update_plan.execute!({ ...samplePlan(), revision: plan.plan!.revision }, call)) as {
    success: boolean
  }
  assert({
    given: 'a separate requested file move and a plan already paused',
    should: 'record its verified path while refusing to resume unrelated work',
    actual: [updated.success, plan.plan?.artifacts[0]?.location, resumed.success, plan.plan?.status, browsers],
    expected: [true, destination, false, 'paused', 0],
  })
})

test('questions leave an existing plan paused while admitted continuation and draft-only requests retain their scope', async () => {
  const plan = controller()
  await plan.update(samplePlan())
  await plan.pause()
  const paused = structuredClone(plan.plan)
  let intent: TaskIntent = { kind: 'answer', browser: false }
  const tools = createTaskTools({ plan, admit: async () => intent, runBrowser: async () => CommandResult.success() })
  await tools.read_plan.execute!({}, call)
  const refused = (await tools.update_plan.execute!({ ...samplePlan(), revision: plan.plan!.revision }, call)) as {
    success: boolean
  }
  assert({
    given: 'a question about paused work',
    should: 'allow inspection without resuming or revising it',
    actual: [refused.success, plan.plan],
    expected: [false, paused],
  })
  intent = { kind: 'workflow', browser: true }
  const resumed = (await tools.update_plan.execute!({ ...samplePlan(), revision: plan.plan!.revision }, call)) as {
    success: boolean
  }
  assert({
    given: 'a subsequent request to continue delegated work',
    should: 'resume once with the caller’s valid revision',
    actual: [resumed.success, plan.plan?.status, plan.plan?.revision],
    expected: [true, 'working', paused!.revision + 1],
  })
  const draft = controller()
  const drafting = createTaskTools({
    plan: draft,
    admit: async () => ({ kind: 'draft', browser: false }),
    runBrowser: async () => {
      throw new Error('Must not run')
    },
  })
  const work = (await drafting.update_plan.execute!(samplePlan(), call)) as { success: boolean }
  const made = (await drafting.update_plan.execute!(
    { ...samplePlan(), status: 'draft', steps: samplePlan().steps.map((step) => ({ ...step, status: 'pending' })) },
    call,
  )) as { success: boolean }
  assert({
    given: 'a request for a plan without execution',
    should: 'accept a draft and refuse working state',
    actual: [work.success, made.success, draft.plan?.status],
    expected: [false, true, 'draft'],
  })
})

test('retrying one source continues an existing plan while questions and unrelated actions do not', async () => {
  for (const scenario of [
    { request: 'Try Atlas again.', kind: 'action', continuation: 0.99, expected: 'workflow' },
    { request: 'Why did Atlas fail?', kind: 'answer', continuation: 0.99, expected: 'answer' },
    { request: 'Open the unrelated example website.', kind: 'action', continuation: 0.01, expected: 'action' },
  ] as const) {
    const plan = controller()
    await plan.update(samplePlan())
    await plan.pause()
    let tracked = false
    const client = new TypeSafeClient({
      apiKey: 'test',
      logLevel: 'off',
      fetch: (async () =>
        Response.json({
          model: 'test',
          usage: { input_tokens: 50, output_tokens: 0 },
          answers: {
            intent: {
              type: 'choice',
              choice: scenario.kind,
              confidence: 0.99,
              probabilities: { [scenario.kind]: 0.99 },
            },
            browser: { type: 'noul', noul: scenario.kind === 'answer' ? 0.01 : 0.99 },
            continuePlan: { type: 'noul', noul: scenario.continuation },
          },
        })) as unknown as typeof fetch,
    })
    const admit = taskAdmission(client, [{ role: 'user', content: scenario.request }], plan.plan, { sink: () => {} })
    const tools = createTaskTools({
      plan,
      admit,
      runBrowser: async () => {
        tracked = !!browserTaskHost.getStore()?.browserRun
        return CommandResult.success()
      },
    })
    await tools.browser_task.execute!({ objective: scenario.request }, call)
    assert({
      given: scenario.request,
      should: 'keep a requested source retry attached to the plan without resuming for unrelated work or questions',
      actual: [(await admit()).kind, plan.plan?.status, tracked],
      expected: [
        scenario.expected,
        scenario.expected === 'workflow' ? 'working' : 'paused',
        scenario.expected === 'workflow',
      ],
    })
  }
})

test('an unavailable intent adviser does not become a prerequisite for browser access or plan creation', async () => {
  const client = new TypeSafeClient({
    apiKey: 'test',
    logLevel: 'off',
    fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
  })
  const plan = controller()
  const admit = taskAdmission(
    client,
    [{ role: 'user', content: 'Collect the example tax documents and check the folder.' }],
    null,
    { sink: () => {} },
  )
  const tools = createTaskTools({
    plan,
    admit,
    runBrowser: async () => CommandResult.success({ report: 'Example task finished.' }),
  })
  const result = (await tools.update_plan.execute!(samplePlan(), call)) as { success: boolean }
  assert({
    given: 'an optional service without a usable key',
    should: 'retain the main model’s scoped tools and instructions',
    actual: [await admit(), result.success],
    expected: [{ kind: 'unknown', browser: null }, true],
  })
})

test('a live plan shares one browser worker across tools and turns and closes it at completion or pause', async () => {
  for (const finish of ['complete', 'pause'] as const) {
    const plan = controller()
    await plan.update(samplePlan())
    let starts = 0
    let closes = 0
    const runBrowser = async () => {
      const host = browserTaskHost.getStore()!
      if (!host.browserRun || !host.runObjective?.includes(samplePlan().title)) throw new Error('Missing run scope')
      const browser = await host.browserRun.acquire(async () => {
        starts++
        return {
          listTools: async () => [],
          callTool: async () => ({ content: [], isError: false }),
          close: async () => {
            closes++
          },
        }
      }, {})
      await browser.close()
      return CommandResult.success({ report: 'Example website checked.' })
    }
    for (let turn = 0; turn < 2; turn++) {
      const tools = createTaskTools({ plan, admit: async () => ({ kind: 'workflow', browser: true }), runBrowser })
      await tools.browser_task.execute!({ objective: 'Check the example website.' }, call)
    }
    const before = [starts, closes]
    if (finish === 'pause') await plan.pause()
    else
      await plan.update({
        ...samplePlan(),
        revision: plan.plan!.revision,
        status: 'complete',
        finalCheck: 'All example checks finished.',
        steps: [samplePlan().steps[0]!],
      })
    assert({
      given: `two tools in separate turns followed by ${finish}`,
      should: 'retain authorization while working and release the worker at the run boundary',
      actual: [before, starts, closes],
      expected: [[1, 0], 1, 1],
    })
  }
})
