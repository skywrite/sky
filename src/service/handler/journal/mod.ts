import * as path from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { createProcessJob } from '#lib/jobs/mod.ts'
import { createJournalAI } from '#lib/journal/ai.ts'
import { journalStaples } from '#lib/journal/staples.ts'
import { journalDayDir, journalStore } from '#lib/journal/store.ts'
import { JournalError, type JournalAI, type JournalPaths } from '#lib/journal/types.ts'
import { runJournalJob, type JournalJob } from '#lib/journal/worker.ts'
import slugify from '#lib/string/slugify.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'

export interface JournalOptions {
  ai?: JournalAI
}
const operationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  action: z.enum(['prepare', 'deeper', 'reframe']),
  topic: z.string().optional(),
})
const editSchema = z.object({
  content: z.string().max(450_000),
  version: z.number().int().nonnegative(),
  force: z.boolean().optional(),
})
const topicSchema = z.object({ action: z.enum(['select', 'skip', 'restore', 'finish', 'rename']) })

export function createJournalRoutes(
  paths: JournalPaths,
  options: JournalOptions = {},
  now: () => ZonedDateTime = () => {
    try {
      return fetchNowSync()
    } catch {
      return new ZonedDateTime()
    }
  },
) {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 512_000 }))
  app.onError((error, c) =>
    c.json(
      { message: error.message },
      error instanceof JournalError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  const job = (day: string) =>
    createProcessJob<JournalJob, void>({
      dir: path.join(journalDayDir(paths, day), 'jobs'),
      module: new URL('../../../lib/journal/worker.ts', import.meta.url),
    })
  app.get('/:day', async (c) => {
    const day = c.req.param('day')
    const store = journalStore(paths, day)
    if (!options.ai)
      await store.lock(async () => {
        const session = await store.read()
        if (session?.operation?.status !== 'running') return
        const record = await job(day).status()
        if (!record || record.input.request !== session.operation.id || record.status !== 'running') {
          session.operation.status = 'failed'
          session.operation.error =
            record?.error ?? 'Question preparation was interrupted. Retry to continue; your writing is saved.'
          await store.save(session)
        }
      })
    return c.json(await store.view())
  })
  app.post('/:day/start', async (c) => {
    const day = c.req.param('day')
    const store = journalStore(paths, day)
    await store.start(now().plainDateTime.time, await journalStaples(paths.notebookDir, day))
    return c.json(await store.view())
  })
  app.post('/:day/operation', async (c) => {
    const day = c.req.param('day')
    const request = operationSchema.parse(await c.req.json())
    const store = journalStore(paths, day)
    let run = false
    await store.lock(async () => {
      const session = await store.requireSession()
      if (session.completed.includes(request.id) || session.operation?.id === request.id) return
      if (session.operation?.status === 'running')
        throw new JournalError('Sky is still preparing a question. You can keep writing while it finishes.', 409)
      if (request.action === 'prepare' && session.prepared) return
      if (!options.ai && (await job(day).status())?.status === 'running')
        throw new JournalError('Sky is finishing the previous question. Try again in a moment.', 409)
      if (request.action !== 'prepare') {
        const topic = store.topicOf(session, request.topic ?? '')
        const view = await store.snapshot(session)
        if (view.problems[topic.id]) throw new JournalError(view.problems[topic.id], 409)
        const questions = topic.questions.filter((question) => !question.dismissed)
        if (!questions.length) throw new JournalError('Restore a question or choose another reflection to continue.')
        const answered = questions.some((question) => view.answers[topic.id]?.[question.id]?.trim())
        if (request.action === 'reframe' && (topic.staple || topic.file))
          throw new JournalError('Try another angle is available before writing an optional reflection.')
        if (request.action === 'deeper' && !answered)
          throw new JournalError('Write an answer first so Sky has something to respond to.')
        if (
          request.action === 'deeper' &&
          questions.at(-1)?.origin === 'followup' &&
          !view.answers[topic.id]?.[questions.at(-1)!.id]?.trim()
        )
          throw new JournalError('Your last follow-up is still here. Answer it before asking for another.')
      }
      session.operation = {
        ...request,
        status: 'running',
        stage: request.action === 'prepare' ? 'Reading your notebook…' : 'Thinking about your reflection…',
      }
      await store.save(session)
      if (!options.ai) {
        const record = await job(day).start({ paths, day, request: request.id })
        if (record.status === 'failed') {
          session.operation.status = 'failed'
          session.operation.error = record.error
          await store.save(session)
        }
      } else run = true
    })
    // Tests inject an AI; production always uses a detached worker that survives service restarts.
    if (run) void runJournalJob({ paths, day, request: request.id }, options.ai!)
    return c.json(await store.view(), 202)
  })
  app.post('/:day/topics', async (c) => {
    const { title } = z.object({ title: z.string().trim().min(1).max(80) }).parse(await c.req.json())
    const store = journalStore(paths, c.req.param('day'))
    const id = await store.lock(async () => {
      const session = await store.requireSession()
      const base = slugify(title) || 'reflection'
      let id = base
      for (let n = 2; session.topics.some((topic) => topic.id === id); n++) id = `${base}-${n}`
      session.topics.push({
        id,
        title,
        sections: [],
        staple: false,
        observation: '',
        sources: [],
        questions: [{ id: 'q1', text: 'What’s on your mind?', origin: 'regular' }],
      })
      session.current = id
      await store.save(session)
      return id
    })
    return c.json({ id }, 201)
  })
  app.post('/:day/topics/:topic', async (c) => {
    const { action } = topicSchema.parse(await c.req.json())
    const store = journalStore(paths, c.req.param('day'))
    if (action === 'finish' || action === 'rename') {
      const release = hold('finishing a journal')
      try {
        await store.finish(c.req.param('topic'), options.ai ?? createJournalAI(paths), action === 'rename')
      } finally {
        release()
      }
      return c.json(await store.view())
    }
    await store.lock(async () => {
      const session = await store.requireSession()
      const topic = store.topicOf(session, c.req.param('topic'))
      if (action === 'select') session.current = topic.id
      if (action === 'skip') topic.skipped = true
      if (action === 'restore') {
        delete topic.skipped
        delete topic.coveredBy
      }
      await store.save(session)
    })
    return c.json(await store.view())
  })
  app.post('/:day/topics/:topic/questions/:question', async (c) => {
    const { action } = z.object({ action: z.enum(['dismiss', 'restore']) }).parse(await c.req.json())
    const store = journalStore(paths, c.req.param('day'))
    await store.lock(async () => {
      const session = await store.requireSession()
      const topic = store.topicOf(session, c.req.param('topic'))
      const question = topic.questions.find((item) => item.id === c.req.param('question'))
      if (!question) throw new JournalError('This question is no longer in the reflection.', 404)
      if (action === 'dismiss') question.dismissed = true
      else delete question.dismissed
      await store.save(session)
    })
    return c.json(await store.view())
  })
  app.get('/:day/topics/:topic/answers/:question', async (c) => {
    const result = await journalStore(paths, c.req.param('day')).answer(c.req.param('topic'), c.req.param('question'))
    return c.json(c.req.query('meta') === '1' ? { version: result.version } : result)
  })
  app.put('/:day/topics/:topic/answers/:question', async (c) => {
    const input = editSchema.parse(await c.req.json())
    return c.json(
      await journalStore(paths, c.req.param('day')).write(
        c.req.param('topic'),
        c.req.param('question'),
        input.content,
        input.version,
        input.force,
      ),
    )
  })
  app.all('*', (c) => c.json({ message: 'Journal action not found.' }, 404))
  return app
}
