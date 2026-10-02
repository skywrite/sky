import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { journalStore } from '#lib/journal/store.ts'
import type { JournalAI, JournalPaths, JournalView } from '#lib/journal/types.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'

const DAY = '2025-03-18'
async function fixture(
  run: (
    request: (url: string, body?: unknown, method?: string) => Promise<Response>,
    paths: JournalPaths,
  ) => Promise<void>,
  ai?: JournalAI,
) {
  const notebookDir = await mkdtemp(path.join(tmpdir(), 'sky-journal-routes-'))
  const paths = {
    notebookDir,
    timeDir: path.join(notebookDir, 'time'),
    stateDir: path.join(notebookDir, '.user-data/state/journal'),
  }
  try {
    const app = createTestHttpApp([paths.timeDir], {
      now: () => new ZonedDateTime('2025-03-18T18:30:00', 'UTC'),
      journal: ai ? { ai } : undefined,
    })
    await run(
      async (url, body, method = 'POST') =>
        app.request(
          `http://localhost/journal/_api/${url}`,
          body === undefined
            ? undefined
            : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
        ),
      paths,
    )
  } finally {
    await rm(notebookDir, { recursive: true, force: true })
  }
}
const ai: JournalAI = { prepare: async () => [], followup: async () => ({ question: null, covered: [] }) }

test('journal API validates dates, answer versions and unavailable questions', async () => {
  await fixture(async (request) => {
    const badDate = await request('2025-02-31')
    const before = await request(DAY)
    await request(`${DAY}/start`, {})
    const invalidAnswer = await request(
      `${DAY}/topics/health/answers/q1`,
      { content: 'Hello', version: 'invalid' },
      'PUT',
    )
    const missingQuestion = await request(`${DAY}/topics/health/answers/q99`)
    const valid = await request(`${DAY}/topics/health/answers/q1`, { content: 'A quiet evening.', version: 0 }, 'PUT')
    const stale = await request(`${DAY}/topics/health/answers/q1`, { content: 'Stale draft.', version: 0 }, 'PUT')
    assert({
      given: 'first-use reads, malformed edits and a stale writer',
      should: 'keep the API precise and prevent an accidental overwrite',
      actual: [
        badDate.status,
        (await before.json()).session,
        invalidAnswer.status,
        missingQuestion.status,
        valid.status,
        stale.status,
      ],
      expected: [400, null, 400, 404, 200, 409],
    })
  }, ai)
})

test('failed AI preparation leaves the regular questions usable and never creates placeholder files', async () => {
  await fixture(
    async (request, paths) => {
      await request(`${DAY}/start`, {})
      await request(`${DAY}/operation`, { id: 'failed-prepare', action: 'prepare' })
      const store = journalStore(paths, DAY)
      for (let n = 0; n < 100; n++) {
        if ((await store.read())?.operation?.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const view = (await (await request(DAY)).json()) as JournalView
      const save = await request(`${DAY}/topics/mood/answers/q1`, { content: 'Calm.', version: 0 }, 'PUT')
      const files = await readdir(path.join(paths.timeDir, dayDir(new PlainDate(DAY)), 'journal'))
      assert({
        given: 'an unavailable AI model',
        should: 'explain the error while allowing regular journaling',
        actual: [
          view.session?.operation?.status,
          view.session?.operation?.error,
          view.session?.topics.map((t) => t.title),
          save.status,
          files.length,
        ],
        expected: ['failed', 'Connect an AI provider in Settings.', ['Health', 'Mood'], 200, 1],
      })
    },
    {
      ...ai,
      prepare: async () => {
        throw new Error('Connect an AI provider in Settings.')
      },
    },
  )
})

test('a repeated operation request starts one producer while unrelated writing proceeds', async () => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await fixture(
    async (request) => {
      await request(`${DAY}/start`, {})
      const first = await request(`${DAY}/operation`, { id: 'one-operation', action: 'prepare' })
      const repeat = await request(`${DAY}/operation`, { id: 'one-operation', action: 'prepare' })
      const other = await request(`${DAY}/operation`, { id: 'other-operation', action: 'prepare' })
      const written = await request(`${DAY}/topics/health/answers/q1`, { content: 'Rested.', version: 0 }, 'PUT')
      assert({
        given: 'a duplicated request while a model is running',
        should: 'deduplicate generation and keep the editor usable',
        actual: [first.status, repeat.status, other.status, calls, written.status],
        expected: [202, 202, 409, 1, 200],
      })
      release()
      for (let n = 0; n < 100; n++) {
        if (((await (await request(DAY)).json()) as JournalView).session?.operation?.status !== 'running') break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    },
    {
      ...ai,
      prepare: async () => {
        calls++
        await ready
        return []
      },
    },
  )
})

test('an interrupted process reservation can be recovered after rebuilding the HTTP app', async () => {
  await fixture(async (request, paths) => {
    await request(`${DAY}/start`, {})
    const store = journalStore(paths, DAY)
    const session = await store.requireSession()
    session.operation = { id: 'abandoned', action: 'prepare', status: 'running', stage: 'Reading…' }
    await store.save(session)
    const freshApp = createTestHttpApp([paths.timeDir], { now: () => new ZonedDateTime('2025-03-18T18:30:00', 'UTC') })
    const result = await freshApp.request(`http://localhost/journal/_api/${DAY}`)
    const view = (await result.json()) as JournalView
    assert({
      given: 'durable session state whose producer never launched',
      should: 'report the interruption instead of spinning forever after a restart',
      actual: [view.session?.operation?.status, view.session?.topics.length],
      expected: ['failed', 2],
    })
  })
})

test('a dismissed follow-up stops blocking deeper reflection and can be restored with stable IDs', async () => {
  await fixture(async (request, paths) => {
    await request(`${DAY}/start`, {})
    await request(`${DAY}/topics/health/answers/q1`, { content: 'A walk helped.', version: 0 }, 'PUT')
    const store = journalStore(paths, DAY)
    const session = await store.requireSession()
    session.topics[0].questions.push({ id: 'q2', text: 'What surprised you?', origin: 'followup' })
    await store.save(session)
    const blocked = await request(`${DAY}/operation`, { id: 'before-dismiss', action: 'deeper', topic: 'health' })
    const dismiss = await request(`${DAY}/topics/health/questions/q2`, { action: 'dismiss' })
    const deeper = await request(`${DAY}/operation`, { id: 'after-dismiss', action: 'deeper', topic: 'health' })
    for (let n = 0; n < 100; n++) {
      if ((await store.read())?.operation?.status !== 'running') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const restore = await request(`${DAY}/topics/health/questions/q2`, { action: 'restore' })
    const view = (await restore.json()) as JournalView
    const missing = await request(`${DAY}/topics/health/questions/q99`, { action: 'dismiss' })
    assert({
      given: 'an unanswered follow-up that the owner chooses to pass over',
      should: 'allow a new follow-up and restore the same question without losing the original answer',
      actual: [
        blocked.status,
        dismiss.status,
        deeper.status,
        view.session?.topics[0].questions.map((q) => [q.id, Boolean(q.dismissed)]),
        view.answers.health.q1,
        missing.status,
      ],
      expected: [
        400,
        200,
        202,
        [
          ['q1', false],
          ['q2', false],
        ],
        'A walk helped.',
        404,
      ],
    })
  }, ai)
})
