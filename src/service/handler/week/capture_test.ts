import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { captureWeekGoal, type WeekCaptureResult } from './capture.ts'
import { buildWeekView, createWeekRoutes } from './mod.ts'
import { parseWeekPlan } from './plan.ts'

const TODAY = new PlainDate('2026-05-18')
const THIS_WEEK = Week.of(TODAY)

async function fixture() {
  const root = await makeTempDir({ prefix: 'sky-week-capture-' })
  const options = {
    markdownBaseDir: root,
    timeDir: path.join(root, 'time'),
    captureStateDir: path.join(root, 'state'),
    now: () => new ZonedDateTime(new PlainDateTime('30:15', '2026-05-17'), 'America/Chicago'),
  }
  const file = path.join(options.timeDir, weekDir(TODAY), 'week.md')
  const app = createWeekRoutes(options)
  return {
    root,
    options,
    file,
    app,
    capture: (input: unknown, week = THIS_WEEK) =>
      captureWeekGoal({ ...options, stateDir: options.captureStateDir }, week, TODAY, input),
    post: (body: unknown, headers: Record<string, string> = {}) =>
      app.request('http://localhost/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    write: async (content: string) => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}

test('week capture starts a minimal plan in the notebook calendar week', async () => {
  const f = await fixture()
  try {
    const response = await f.post({ text: 'Finish the Atlas outline', requestId: 'first' })
    const result = (await response.json()) as WeekCaptureResult
    const view = await buildWeekView(f.options)
    const content = await readFile(f.file, 'utf8')
    assert({
      given: 'an empty notebook on Sunday at 30:15, already Monday on its clock',
      should: 'create a visible goal in the new calendar week with useful frontmatter',
      actual: {
        status: response.status,
        id: result.id,
        path: result.path,
        goals: view.plan?.goals.map(({ category, text }) => ({ category, text })),
        frontmatter: content.startsWith('---\ncreated: 2026-05-18\nupdated: 2026-05-18\n---\n'),
        workstreamsExist: await exists(path.join(f.root, 'workstreams')),
      },
      expected: {
        status: 200,
        id: THIS_WEEK.toString(),
        path: path.relative(f.root, f.file),
        goals: [{ category: 'To do', text: 'Finish the Atlas outline' }],
        frontmatter: true,
        workstreamsExist: false,
      },
    })
  } finally {
    await f.dispose()
  }
})

test('week capture preserves the existing plan and appends within a neutral category', async () => {
  const f = await fixture()
  const original =
    '---\r\ncreated: 2026-05-16\r\nsummary: Keep the launch steady\r\ncustom: [one, two]\r\n---\r\n\r\n' +
    '# Week plan\r\n\r\n## Priorities\r\n\r\n1. Existing priority\r\n\r\n## Goals\r\n\r\n' +
    '### Professional\r\n\r\n- ~~Existing finished goal~~\r\n  - WHY: Keep this line\r\n\r\n' +
    '### To do\r\n\r\n- Existing neutral goal\r\n\r\n## Notes\r\n\r\nKeep all of these notes.\r\n'
  try {
    await f.write(original)
    await f.capture({ text: 'Review the outline', requestId: 'preserve' })
    const content = await readFile(f.file, 'utf8')
    const restored = content.replace(/\r\n- Review the outline\r\n<!-- sky-week-capture:[a-f0-9]+ -->\r\n\r\n/, '')
    assert({
      given: 'a CRLF plan with custom YAML, existing goals, WHY lines and notes after Goals',
      should: 'preserve every original byte and show the new neutral goal before Notes',
      actual: [
        restored === original,
        parseWeekPlan(content).goals.map(({ category, text, done }) => ({ category, text, done })),
      ],
      expected: [
        true,
        [
          { category: 'Professional', text: 'Existing finished goal', done: true },
          { category: 'To do', text: 'Existing neutral goal', done: false },
          { category: 'To do', text: 'Review the outline', done: false },
        ],
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('week capture creates missing goal headings without replacing an existing plan', async () => {
  for (const suffix of ['', '\n## Goals\n\n### Personal\n\n- Read a chapter\n']) {
    const f = await fixture()
    try {
      const original = '# Existing week\n\nKeep this intention.\n' + suffix
      await f.write(original)
      await f.capture({ text: 'Review the outline', requestId: 'add-headings' })
      const content = await readFile(f.file, 'utf8')
      assert({
        given: suffix ? 'a plan without the neutral category' : 'a plan without Goals',
        should: 'keep its content and add a visible goal',
        actual: [content.startsWith(original), parseWeekPlan(content).goals.at(-1)?.text],
        expected: [true, 'Review the outline'],
      })
    } finally {
      await f.dispose()
    }
  }
})

test('week captures serialize concurrent additions and deduplicate retries across a week boundary', async () => {
  const f = await fixture()
  try {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        f.capture({ text: `Review draft ${i % 4}`, requestId: `concurrent-${i % 4}` }),
      ),
    )
    const before = await readFile(f.file, 'utf8')
    const retry = await f.capture({ text: 'Review draft 0', requestId: 'concurrent-0' }, THIS_WEEK.next())
    const conflict = await f.post({ text: 'A different intention', requestId: 'concurrent-0' })
    assert({
      given: 'four goals submitted twice simultaneously, a later retry, and a reused ID with different text',
      should: 'save each once, keep the original week and reject conflicting reuse',
      actual: [
        parseWeekPlan(before)
          .goals.map((goal) => goal.text)
          .sort(),
        retry.id,
        (await readFile(f.file, 'utf8')) === before,
        conflict.status,
      ],
      expected: [
        ['Review draft 0', 'Review draft 1', 'Review draft 2', 'Review draft 3'],
        THIS_WEEK.toString(),
        true,
        409,
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('week capture recovers a saved goal with an unfinished retry receipt', async () => {
  const f = await fixture()
  try {
    const input = { text: 'Review the outline', requestId: 'interrupted' }
    await f.capture(input)
    const before = await readFile(f.file, 'utf8')
    await writeFile(
      path.join(f.options.captureStateDir, `${hash(input.requestId)}.json`),
      JSON.stringify({ id: THIS_WEEK.toString(), textHash: hash(input.text), complete: false }),
    )
    await f.capture(input)
    assert({
      given: 'a goal saved before the process finished its receipt',
      should: 'recognize the saved marker without appending the goal again',
      actual: await readFile(f.file, 'utf8'),
      expected: before,
    })
  } finally {
    await f.dispose()
  }
})

test('week capture rejects foreign and invalid writes and turns multiline input into one goal', async () => {
  const f = await fixture()
  try {
    const input = { text: 'Review the outline', requestId: 'validation' }
    const statuses = await Promise.all([
      f.post(input, { origin: 'https://example.com' }),
      f.post(input, { 'sec-fetch-site': 'cross-site' }),
      f.post(input, { 'content-type': 'text/plain' }),
      f.post({ ...input, text: ' \n\t ' }),
      f.post({ ...input, text: 'x'.repeat(20_001) }),
      f.post({ ...input, requestId: '' }),
      f.post({ text: 123, requestId: 'wrong-type' }),
    ])
    assert({
      given: 'foreign origins, non-JSON bodies and invalid capture values',
      should: 'reject all before writing a plan',
      actual: [statuses.map((response) => response.status), await exists(f.file)],
      expected: [[403, 403, 415, 400, 400, 400, 400], false],
    })
    await f.post({
      text: ' - [ ] Review the outline\r\n\r\n## Notes\n- Second line\twith detail',
      requestId: 'multiline',
    })
    const content = await readFile(f.file, 'utf8')
    assert({
      given: 'a pasted checkbox and several lines that look like Markdown structure',
      should: 'keep a single goal and never inject a heading or additional goal',
      actual: parseWeekPlan(content).goals.map((goal) => goal.text),
      expected: ['Review the outline ## Notes - Second line with detail'],
    })
  } finally {
    await f.dispose()
  }
})

test('week capture does not follow a plan symlink', async () => {
  const f = await fixture()
  try {
    const target = path.join(f.root, 'untouched.md')
    await writeFile(target, 'Keep this file.\n')
    await mkdir(path.dirname(f.file), { recursive: true })
    await symlink(target, f.file)
    const response = await f.post({ text: 'Review the outline', requestId: 'symlink' })
    assert({
      given: 'a week plan that links to another file',
      should: 'reject the write and leave the destination untouched',
      actual: [response.status, await readFile(target, 'utf8')],
      expected: [400, 'Keep this file.\n'],
    })
  } finally {
    await f.dispose()
  }
})

test('week capture refuses raw HTML while allowing ordinary comparisons', async () => {
  const f = await fixture()
  try {
    const inputs = ['Review <!-- hidden --> text', '<img src=x onerror=alert(1)>', '<script>doSomething()</script>']
    const responses = await Promise.all(inputs.map((text, i) => f.post({ text, requestId: `html-${i}` })))
    const before = await exists(f.file)
    const response = await f.post({ text: 'Keep error rate < 5% and finish > 10 drafts', requestId: 'comparison' })
    assert({
      given: 'raw tags and comments, followed by a plain-text numerical comparison',
      should: 'reject active markup without rejecting an ordinary goal',
      actual: [
        responses.map((item) => item.status),
        before,
        response.status,
        parseWeekPlan(await readFile(f.file, 'utf8')).goals.map((goal) => goal.text),
      ],
      expected: [[400, 400, 400], false, 200, ['Keep error rate < 5% and finish > 10 drafts']],
    })
  } finally {
    await f.dispose()
  }
})
