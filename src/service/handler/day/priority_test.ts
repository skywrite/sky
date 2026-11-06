import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setPlanOrder } from '#lib/nbfs/planOrder.ts'
import { priorityOrderRows, type PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createItemRoutes } from './item.ts'
import { buildDayView } from './mod.ts'
import { createDayPriority } from './priority.ts'
import { createDayPrioritizer, type PriorityEvidence } from './priorityAI.ts'
import { priorityContextSources, readPriorityContext } from './priorityContext.ts'

const DAY = new PlainDate('2031-03-17')
const CONTENT =
  '## Most Important\n\n- Decide the Atlas scope\n\n## Professional Todos\n\n- Draft Atlas brief\n- Send agenda\n\n## Personal Commitments\n\n- 17:00 > Book annual checkup\n'
const evidence: PriorityEvidence = {
  day: DAY.ymd,
  time: '09:00',
  mostImportant: ['Decide the Atlas scope'],
  context: [{ path: 'goals/Health.md', text: 'Protect health alongside the Atlas launch.', excerpt: false }],
  tasks: [
    { text: 'Draft Atlas brief', notes: 'Due tomorrow', time: null, category: 'Professional', manual: false },
    { text: 'Book annual checkup', notes: '', time: '17:00', category: 'Personal', manual: false },
  ],
}

for (const group of ['todos', 'reminders'] as const) {
  test(`completing successive ${group} preserves survivors, manual slots and Undo across restarts`, async () => {
    const root = await mkdtemp('/tmp/sky-priority-progress-')
    const timeDir = path.join(root, 'time')
    const file = path.join(timeDir, dayFile(DAY))
    const names = {
      todos: [
        'Draft Atlas brief',
        'Send agenda',
        'Book a checkup',
        'Review supplies',
        'Prepare the review',
        'Plan the next release',
        'File notes',
      ],
      reminders: [
        'Pause before replying',
        'Keep the goal in mind',
        'Leave room for a walk',
        'Review assumptions',
        'Ask what success means',
        'Make room for reflection',
        'Leave space between meetings',
      ],
    }
    let content = `## Most Important\n\n- Decide the Atlas scope\n\n## Professional Todos\n\n${names.todos.map((text) => '- ' + text).join('\n')}\n\n## Reminders\n\n${names.reminders.map((text) => '- ' + text).join('\n')}\n`
    for (const list of ['todos', 'reminders'] as const) {
      content = setPlanOrder(
        content,
        list === 'todos' ? 'todo-order' : 'reminder-order',
        priorityOrderRows(content, list).map((row, index) => ({ ...row.entry, manual: index === 2 })),
      )
    }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    const calls = { todos: 0, reminders: 0 }
    const make = (list: PriorityGroup) =>
      createDayPriority(
        {
          markdownBaseDir: root,
          timeDir,
          stateDir: path.join(root, 'state', list),
          context: async () => [],
          rank: async ({ tasks }) => {
            calls[list]++
            // A second model call would reshuffle the list and expose the completion bug.
            return tasks.map((item, index) =>
              calls[list] === 1 ? 4 - [4, 1, 0, 3, 5, 6, 2].indexOf(names[list].indexOf(item.text)) / 2 : index / 2,
            )
          },
        },
        list,
      )
    let hosts = { todos: make('todos'), reminders: make('reminders') }
    const rawView = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
    const view = async () => hosts.reminders.apply(await hosts.todos.apply(await rawView()))
    const routes = createItemRoutes({ markdownBaseDir: root, timeDir, today: () => DAY, view })
    const post = async (route: string, body: unknown) => {
      const response = await routes.request(`/${DAY.ymd}/item${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      return (await response.json()) as { undo?: string; itemUndo?: string }
    }
    const ranked = (day: Awaited<ReturnType<typeof view>>, list: PriorityGroup = group) =>
      (list === 'todos' ? [...day.record.todos, ...day.record.commitments] : [...day.record.reminders])
        .filter((item) => !item.done)
        .sort((a, b) => a.priority! - b.priority!)
    const expected = [4, 1, 2, 0, 3, 5, 6].map((index) => names[group][index])
    try {
      await Promise.all([hosts.todos.refresh(DAY.ymd, rawView), hosts.reminders.refresh(DAY.ymd, rawView)])
      assert({
        given: 'AI scores that move source rows across a manual slot',
        should: 'show the resolved priority order before anything is completed',
        actual: ranked(await view()).map((item) => item.text),
        expected,
      })
      const undo: string[] = []
      for (let count = 1; count <= 2; count++) {
        const first = ranked(await view())[0]
        const result = await post(group === 'todos' ? '' : '/delete', { ...first, done: true })
        undo.push((group === 'todos' ? result.itemUndo : result.undo)!)
        hosts = { todos: make('todos'), reminders: make('reminders') }
        await Promise.all([hosts.todos.refresh(DAY.ymd, rawView), hosts.reminders.refresh(DAY.ymd, rawView)])
        const current = await view()
        const status = group === 'todos' ? current.record.todoPriority : current.record.reminderPriority
        assert({
          given: `${count} completed ${group}, a reload, and a service restart`,
          should: 'advance survivors in exactly the same order without asking either model again',
          actual: {
            order: ranked(current).map((item) => item.text),
            pinned: ranked(current).find((item) => item.text === names[group][2])?.priorityManual,
            current: status?.revision === status?.inputRevision,
            calls,
          },
          expected: { order: expected.slice(count), pinned: true, current: true, calls: { todos: 1, reminders: 1 } },
        })
      }
      for (const id of undo.reverse()) await post('/row/undo', { id })
      const restored = await view()
      assert({
        given: 'Undo for both completions',
        should: 'restore the original positions and day content without reranking',
        actual: [ranked(restored).map((item) => item.text), await readFile(file, 'utf8'), calls],
        expected: [expected, content, { todos: 1, reminders: 1 }],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('Jev rates every to-do against contextual evidence through the metered client and rejects malformed scores', async () => {
  const calls: Array<{ state: PriorityEvidence; questions: Record<string, unknown> }> = []
  const usage: AIUsageRecord[] = []
  let malformed = false
  const client = createTypeSafeClient({
    secrets: new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') }),
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return Response.json({
        model: 'jev-test',
        answers: Object.fromEntries(
          [3, 4].map((value, index) => [
            `task_${index}`,
            {
              type: 'score',
              score: value,
              confidence: 1,
              legend: {},
              probabilities: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, [value]: malformed ? 0.1 : 1 },
            },
          ]),
        ),
        usage: { input_tokens: 500, output_tokens: 0 },
      })
    }) as typeof fetch,
  })
  const rank = createDayPrioritizer(client, (record) => {
    usage.push(record)
  })
  const scores = await rank(evidence)
  const reminderEvidence: PriorityEvidence = {
    ...evidence,
    group: 'reminders',
    related: ['Draft the Atlas launch brief'],
    tasks: evidence.tasks.map((item, index) => ({
      ...item,
      text: index ? 'Keep the long-term goal in mind' : 'Pause before replying',
      time: null,
    })),
  }
  await rank(reminderEvidence)
  assert({
    given: 'reminders such as habits and principles rather than actionable tasks',
    should: 'send their own list and task context with the reminder relevance rubric',
    actual: [calls[1].state, JSON.stringify(calls[1].questions).includes('they do not need to be actionable tasks')],
    expected: [reminderEvidence, true],
  })
  malformed = true
  let rejected = false
  try {
    await rank(evidence)
  } catch {
    rejected = true
  }
  assert({
    given: 'contextual tasks and one malformed provider response',
    should: 'send all evidence, record Jev usage, and refuse an invalid probability distribution',
    actual: [scores, calls[0].state, Object.keys(calls[0].questions), usage[0].provider, rejected],
    expected: [[3, 4], evidence, ['task_0', 'task_1'], 'typesafe', true],
  })
})

test('Jev maintains reminder relevance independently and preserves manually chosen reminder slots', async () => {
  const root = await mkdtemp('/tmp/sky-reminder-priority-test-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  const content =
    CONTENT + '\n## Reminders\n\n- Pause before replying\n- Leave room for a walk\n- Keep the long-term goal in mind\n'
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  let calls = 0
  let context = 'A difficult conversation is planned.'
  let scores = [4, 1, 2]
  let received: PriorityEvidence | undefined
  const options = {
    markdownBaseDir: root,
    timeDir,
    stateDir: path.join(root, 'state', 'reminders'),
    context: async () => [{ path: 'goals/Focus.md', text: context, excerpt: false }],
    rank: async (input: PriorityEvidence) => {
      received = input
      calls++
      return scores
    },
  }
  const view = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
  const ordered = (result: Awaited<ReturnType<typeof view>>) =>
    [...result.record.reminders].sort((a, b) => a.priority! - b.priority!).map((item) => item.text)
  try {
    const host = createDayPriority(options, 'reminders')
    await host.refresh(DAY.ymd, view)
    await host.refresh(DAY.ymd, view)
    const result = await host.apply(await view())
    assert({
      given: 'reminders evaluated alongside contextual to-dos and Most Important',
      should: 'rank only reminders, cache the judgment and leave source files untouched',
      actual: [
        calls,
        received?.group,
        received?.tasks.map((item) => item.text),
        received?.related?.length,
        ordered(result),
        result.record.todos.map((item) => item.text),
        await readFile(file, 'utf8'),
      ],
      expected: [
        1,
        'reminders',
        ['Pause before replying', 'Leave room for a walk', 'Keep the long-term goal in mind'],
        3,
        ['Pause before replying', 'Keep the long-term goal in mind', 'Leave room for a walk'],
        ['Draft Atlas brief', 'Send agenda'],
        content,
      ],
    })
    const rows = priorityOrderRows(content, 'reminders')
    await writeFile(
      file,
      setPlanOrder(
        content,
        'reminder-order',
        [rows[1], rows[0], rows[2]].map((row, index) => ({
          ...row.entry,
          manual: index === 0,
        })),
      ),
    )
    context = 'Protect the long-term goal during today’s decisions.'
    scores = [0, 1, 4]
    await host.refresh(DAY.ymd, view)
    const reloaded = createDayPriority(options, 'reminders')
    assert({
      given: 'a reminder moved first by the person and a change in contextual priorities',
      should: 'retain that slot while Jev updates the other reminders, including after restart',
      actual: [calls, ordered(await reloaded.apply(await view()))],
      expected: [2, ['Leave room for a walk', 'Keep the long-term goal in mind', 'Pause before replying']],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Jev priorities follow changed inputs, reuse unchanged context and preserve overrides across restarts', async () => {
  const root = await mkdtemp('/tmp/sky-priority-test-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  let calls = 0
  let context = 'Focus on the launch.'
  let time = '09:12'
  let received: PriorityEvidence | undefined
  let scores = [4, 2, 1]
  const options = {
    markdownBaseDir: root,
    timeDir,
    stateDir: path.join(root, 'state'),
    time: () => time,
    context: async () => {
      return [{ path: 'goals/Focus.md', text: context, excerpt: false }]
    },
    rank: async (input: PriorityEvidence) => {
      received = input
      calls++
      return scores
    },
  }
  const view = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
  const titles = (result: Awaited<ReturnType<typeof view>>) =>
    [...result.record.todos, ...result.record.commitments]
      .sort((a, b) => a.priority! - b.priority!)
      .map((row) => row.text)
  try {
    const host = createDayPriority(options)
    await Promise.all([host.refresh(DAY.ymd, view), host.refresh(DAY.ymd, view)])
    await host.refresh(DAY.ymd, view)
    assert({
      given: 'unchanged context and repeated or simultaneous requests',
      should: 'rank once, cache the result, and leave the notebook untouched',
      actual: [calls, titles(await host.apply(await view())), await readFile(file, 'utf8')],
      expected: [1, ['Draft Atlas brief', 'Send agenda', 'Book annual checkup'], CONTENT],
    })
    time = '19:02'
    const restarted = createDayPriority(options)
    await restarted.refresh(DAY.ymd, view)
    const unchanged = await restarted.apply(await view())
    assert({
      given: 'a later time and a service restart with unchanged day and context files',
      should: 'reuse the saved ranking without asking Jev again',
      actual: [calls, unchanged.record.todoPriority?.revision],
      expected: [1, unchanged.record.todoPriority?.inputRevision],
    })
    context = 'Protect time for reflection.'
    const changed = await host.apply(await view())
    await host.refresh(DAY.ymd, view)
    assert({
      given: 'only an external context source changes',
      should: 'invalidate the saved ranking and use the updated context without modifying the day file',
      actual: [
        calls,
        changed.record.todoPriority?.revision !== changed.record.todoPriority?.inputRevision,
        received?.context[0].text,
        await readFile(file, 'utf8'),
      ],
      expected: [2, true, context, CONTENT],
    })
    const withNotes = CONTENT.replace('- Draft Atlas brief', '- Draft Atlas brief\n  Use the updated review notes.')
    await writeFile(file, withNotes)
    await host.refresh(DAY.ymd, view)
    assert({
      given: 'only the notes beneath a day item change',
      should: 'rank again using the current time and context',
      actual: [calls, received?.time, received?.context[0].text, received?.tasks[0].notes],
      expected: [3, '19:02', context, 'Draft Atlas brief\nUse the updated review notes.'],
    })
    const rows = priorityOrderRows(CONTENT)
    await writeFile(
      file,
      setPlanOrder(
        withNotes,
        'todo-order',
        [rows[1], rows[0], rows[2]].map((row, index) => ({
          ...row.entry,
          manual: index === 0,
        })),
      ),
    )
    context = 'The health appointment must be arranged today.'
    // Evidence now follows the saved order: agenda, brief, checkup.
    scores = [0, 1, 4]
    await host.refresh(DAY.ymd, view)
    const fresh = createDayPriority(options)
    const result = await fresh.apply(await view())
    assert({
      given: 'new context and a person putting the agenda first',
      should: 'keep the human slot while reranking the other tasks, including after a service restart',
      actual: [calls, titles(result), result.record.mostImportant.map((item) => item.text)],
      expected: [4, ['Send agenda', 'Book annual checkup', 'Draft Atlas brief'], ['Decide the Atlas scope']],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a day-file change during ranking gets its own result after the older request finishes', async () => {
  const root = await mkdtemp('/tmp/sky-priority-latest-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  const began = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const inputs: PriorityEvidence[] = []
  const view = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
  const host = createDayPriority({
    markdownBaseDir: root,
    timeDir,
    stateDir: path.join(root, 'state'),
    context: async () => [],
    rank: async (input) => {
      inputs.push(input)
      if (inputs.length === 1) {
        began.resolve()
        await release.promise
      }
      return input.tasks.map(() => 1)
    },
  })
  try {
    const initial = host.refresh(DAY.ymd, view)
    await began.promise
    const updated = CONTENT.replace('Draft Atlas brief', 'Revise Atlas brief')
    await writeFile(file, updated)
    const following = host.refresh(DAY.ymd, view)
    release.resolve()
    await Promise.all([initial, following])
    const result = await host.apply(await view())
    assert({
      given: 'a second priority request for a changed file while the first model call is pending',
      should: 'discard the older judgment and rank the current file without waiting for another edit',
      actual: [inputs.map((input) => input.tasks[0].text), result.record.todoPriority?.revision],
      expected: [['Draft Atlas brief', 'Revise Atlas brief'], result.record.todoPriority?.inputRevision],
    })
  } finally {
    release.resolve()
    await rm(root, { recursive: true, force: true })
  }
})

test('changed or temporarily unreadable context cannot publish a stale ranking or block the day', async () => {
  const root = await mkdtemp('/tmp/sky-priority-context-race-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  const began = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const contexts: string[] = []
  let context = 'Initial goal'
  let unreadable = false
  const view = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
  const host = createDayPriority({
    markdownBaseDir: root,
    timeDir,
    stateDir: path.join(root, 'state'),
    context: async () => {
      if (unreadable) throw new Error('The context source is unavailable')
      return [{ path: 'goals/Focus.md', text: context, excerpt: false }]
    },
    rank: async (input) => {
      contexts.push(input.context[0].text)
      if (contexts.length === 1) {
        began.resolve()
        await release.promise
      }
      return input.tasks.map(() => 1)
    },
  })
  try {
    const initial = host.refresh(DAY.ymd, view)
    await began.promise
    context = 'Revised goal'
    const following = host.refresh(DAY.ymd, view)
    release.resolve()
    await Promise.all([initial, following])
    const result = await host.apply(await view())
    assert({
      given: 'the selected goal changes while Jev is responding',
      should: 'rank the revised context and publish only its matching input revision',
      actual: [contexts, result.record.todoPriority?.revision],
      expected: [['Initial goal', 'Revised goal'], result.record.todoPriority?.inputRevision],
    })
    unreadable = true
    const unavailable = await host.apply(await view())
    unreadable = false
    const recovered = await host.apply(await view())
    assert({
      given: 'a context source becomes temporarily unreadable after a ranking was saved',
      should: 'keep the day and saved order usable, explain the issue, and recover without another model call',
      actual: [
        unavailable.record.todoPriority?.source,
        Boolean(unavailable.record.todoPriority?.warning),
        unavailable.record.todos.map((item) => item.text),
        recovered.record.todoPriority?.revision === recovered.record.todoPriority?.inputRevision,
        Boolean(recovered.record.todoPriority?.warning),
        contexts.length,
      ],
      expected: ['sky', true, result.record.todos.map((item) => item.text), true, false, 2],
    })
  } finally {
    release.resolve()
    await rm(root, { recursive: true, force: true })
  }
})

test('late Jev results cannot overwrite a manual change, and outages retain usable saved order', async () => {
  const root = await mkdtemp('/tmp/sky-priority-race-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  const view = () => buildDayView({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [] }, DAY.ymd)
  let release!: () => void
  let started!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const began = new Promise<void>((resolve) => {
    started = resolve
  })
  const options = { markdownBaseDir: root, timeDir, stateDir: path.join(root, 'state'), context: async () => [] }
  try {
    const host = createDayPriority({
      ...options,
      rank: async () => {
        started()
        await waiting
        return [4, 2, 1]
      },
    })
    const job = host.refresh(DAY.ymd, view)
    await began
    const ordered = priorityOrderRows(CONTENT)
      .reverse()
      .map((row) => row.entry)
    const manual = setPlanOrder(CONTENT, 'todo-order', ordered)
    await writeFile(file, manual)
    release()
    await job
    const failed = createDayPriority({
      ...options,
      rank: async () => {
        throw new Error('Offline')
      },
    })
    await failed.refresh(DAY.ymd, view)
    const result = await failed.apply(await view())
    assert({
      given: 'a manual correction during a request followed by an unavailable provider',
      should: 'preserve the correction and explain that the saved order remains available',
      actual: [
        await readFile(file, 'utf8'),
        result.record.todoPriority?.source,
        Boolean(result.record.todoPriority?.warning),
      ],
      expected: [manual, 'saved', true],
    })
  } finally {
    release()
    await rm(root, { recursive: true, force: true })
  }
})

test('priority context reads the selected notebook and includes goals and linked task notes', async () => {
  const root = await mkdtemp('/tmp/sky-priority-context-')
  try {
    await mkdir(path.join(root, 'goals'))
    await writeFile(path.join(root, 'goals', 'Atlas.md'), '# Launch Atlas\n')
    const timeDir = path.join(root, 'time')
    const day = path.dirname(path.join(timeDir, dayFile(DAY)))
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'brief.md'), 'A deadline in the linked task.\n')
    const context = await readPriorityContext(root, timeDir, DAY, ['brief.md', 'https://example.com/', '/etc/passwd'])
    const sources = priorityContextSources(root, timeDir, DAY, [
      'brief.md',
      'missing.md',
      'https://example.com/',
      '/etc/passwd',
    ])
    assert({
      given: 'a sparse synthetic notebook and internal and external links',
      should: 'include relevant local context without following remote or outside-notebook paths',
      actual: context.map((entry) => entry.text),
      expected: ['# Launch Atlas\n', 'A deadline in the linked task.\n'],
    })
    assert({
      given: 'context sources that exist, have not been created yet, or are outside the notebook',
      should: 'watch eligible missing sources and folders while keeping outside paths out',
      actual: [
        sources.includes('goals/'),
        sources.includes('me/about.md'),
        sources.includes(path.relative(root, path.join(day, 'missing.md'))),
        sources.some((source) => source.includes('/journal/')),
        sources.some((source) => source.includes('passwd') || source.includes('example.com')),
      ],
      expected: [true, true, true, true, false],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
