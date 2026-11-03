import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setPlanOrder } from '#lib/nbfs/planOrder.ts'
import { priorityOrderRows } from '#lib/nbfs/priorityOrder.ts'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayView } from './mod.ts'
import { createDayPriority } from './priority.ts'
import { createDayPrioritizer, type PriorityEvidence } from './priorityAI.ts'
import { readPriorityContext } from './priorityContext.ts'

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

test('cached Jev priorities refresh with context, preserve a human override and survive a new host', async () => {
  const root = await mkdtemp('/tmp/sky-priority-test-')
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, CONTENT)
  let calls = 0
  let context = 'Focus on the launch.'
  let scores = [4, 2, 1]
  const options = {
    markdownBaseDir: root,
    timeDir,
    stateDir: path.join(root, 'state'),
    time: () => '09:12',
    context: async () => [{ path: 'goals/Focus.md', text: context, excerpt: false }],
    rank: async () => {
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
    const rows = priorityOrderRows(CONTENT)
    await writeFile(
      file,
      setPlanOrder(
        CONTENT,
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
      expected: [2, ['Send agenda', 'Book annual checkup', 'Draft Atlas brief'], ['Decide the Atlas scope']],
    })
  } finally {
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
    assert({
      given: 'a sparse synthetic notebook and internal and external links',
      should: 'include relevant local context without following remote or outside-notebook paths',
      actual: context.map((entry) => entry.text),
      expected: ['# Launch Atlas\n', 'A deadline in the linked task.\n'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
