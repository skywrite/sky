import slugify from '#lib/string/slugify.ts'
import { createJournalAI } from './ai.ts'
import { journalStore } from './store.ts'
import { JournalError, type JournalAI, type JournalPaths, type JournalView } from './types.ts'

export interface JournalJob {
  paths: JournalPaths
  day: string
  request: string
}
const signature = (view: JournalView) =>
  JSON.stringify({
    answers: view.answers,
    questions: view.session?.topics.map((topic) =>
      topic.questions.map((question) => [question.id, question.text, Boolean(question.dismissed)]),
    ),
  })

/** Models run outside the transaction; only answers read by that run may shape its follow-up. */
export async function runJournalJob(input: JournalJob, ai: JournalAI): Promise<void> {
  const store = journalStore(input.paths, input.day)
  try {
    const before = await store.view()
    const session = before.session
    const operation = session?.operation
    if (!session || operation?.id !== input.request || operation.status !== 'running') return
    if (Object.keys(before.problems).length && operation.action !== 'prepare')
      throw new JournalError('A reflection changed in its file. Resolve its warning before asking for a follow-up.')
    const progress = async (stage: string) =>
      store.lock(async () => {
        const current = await store.requireSession()
        if (current.operation?.id !== input.request) return
        current.operation.stage = stage
        await store.save(current)
      })
    if (operation.action === 'prepare') {
      const candidates = await ai.prepare(session, progress)
      await store.lock(async () => {
        const current = await store.requireSession()
        if (current.operation?.id !== input.request) return
        const seen = new Set(current.topics.flatMap((t) => t.questions.map((q) => q.text.toLowerCase().trim())))
        for (const candidate of candidates.slice(0, 5)) {
          const key = candidate.question.toLowerCase().trim()
          if (!key || seen.has(key) || /^(health|mood)$/i.test(candidate.title.trim())) continue
          seen.add(key)
          const base = slugify(candidate.title) || 'reflection'
          let id = base
          for (let n = 2; current.topics.some((t) => t.id === id); n++) id = `${base}-${n}`
          current.topics.push({
            id,
            title: candidate.title,
            journalType: candidate.journalType,
            sections: [],
            staple: false,
            observation: candidate.observation,
            sources: candidate.sources,
            questions: [{ id: 'q1', text: candidate.question, origin: 'ai' }],
          })
        }
        current.prepared = true
        current.operation.status = 'complete'
        current.operation.stage = candidates.length
          ? 'Your questions are ready.'
          : 'Your regular questions are ready. Nothing else needs a prompt today.'
        current.completed.push(input.request)
        await store.save(current)
      })
    } else {
      const topic = store.topicOf(session, operation.topic ?? '')
      const result = await ai.followup({
        session,
        topic,
        answers: before.answers,
        reframe: operation.action === 'reframe',
      })
      await store.lock(async () => {
        const current = await store.requireSession()
        if (current.operation?.id !== input.request) return
        const after = await store.snapshot(current)
        if (Object.keys(after.problems).length || signature(after) !== signature(before))
          throw new JournalError(
            'Your reflection changed while Sky was thinking. Ask again to use your latest answers and questions.',
            409,
          )
        const target = store.topicOf(current, topic.id)
        const question = result.question?.trim()
        if (question && !target.questions.some((q) => q.text === question)) {
          if (operation.action === 'reframe') {
            if (target.staple || target.file) throw new JournalError('A regular or saved question cannot be replaced.')
            target.questions = [{ id: 'q1', text: question, origin: 'ai' }]
          } else
            target.questions.push({
              id: `q${target.questions.length + 1}`,
              text: question,
              origin: 'followup',
              basedOn: input.request,
            })
        }
        if (operation.action === 'deeper')
          for (const other of current.topics) {
            if (!other.staple && other.id !== topic.id && !other.file && result.covered.includes(other.id))
              other.coveredBy = topic.id
          }
        current.operation.status = 'complete'
        current.operation.stage = question ? 'Your next question is ready.' : 'This reflection can rest here.'
        current.completed.push(input.request)
        await store.save(current)
      })
    }
  } catch (error) {
    await store.lock(async () => {
      const session = await store.requireSession()
      if (session.operation?.id !== input.request) return
      session.operation.status = 'failed'
      session.operation.error = error instanceof Error ? error.message : 'Sky could not prepare this question.'
      await store.save(session)
    })
  }
}

export default async function work(input: JournalJob): Promise<void> {
  return runJournalJob(input, createJournalAI(input.paths))
}
