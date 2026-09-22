import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { MIDraftInput, MostImportantAI } from '#lib/mostImportant/types.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createReloadGate, RELOAD_EXIT_CODE } from '../../reload.ts'
import { frames, type Frame } from '../theme/client/turnStream.ts'
import { createDayRoutes } from './mod.ts'

const DAY = new PlainDate('2030-06-17')
const DRAFT = {
  summary: 'Send Atlas proposal for feedback',
  dueBy: '',
  body: '## Why this matters\n\nJane needs a concrete proposal.\n\n## Done when\n\n- Proposal sent.\n',
}

test('automatic reload waits for open creation sessions and the final in-flight model request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mi-reload-'))
  const finish = Promise.withResolvers<void>()
  const codes: number[] = []
  const gate = createReloadGate({
    root,
    watch: false,
    graceMs: 5,
    exit: (code) => codes.push(code),
    log: { info: () => {}, warn: () => {} },
  })
  const ai: MostImportantAI = {
    suggest: async () => {
      await finish.promise
      return { contextSummary: '', suggestions: [] }
    },
    question: async () => null,
    draft: async () => DRAFT,
  }
  const app = createDayRoutes({
    markdownBaseDir: root,
    timeDir: path.join(root, 'time'),
    today: () => DAY,
    mostImportant: ai,
  })
  const sessions = [crypto.randomUUID(), crypto.randomUUID()]
  const activity = (id: string, active: boolean) =>
    app.request(`/${DAY.ymd}/mi/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    for (const id of sessions) await activity(id, true)
    gate.request('source changed')
    await settle()
    const betweenQuestions = [...codes]
    await activity(sessions[0], false)
    await settle()
    const otherTab = [...codes]
    const response = await app.request(`/${DAY.ymd}/mi/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: '{}',
    })
    await activity(sessions[1], false)
    await settle()
    const generating = [...codes]
    finish.resolve()
    await response.text()
    await settle()
    assert({
      given: 'a pending reload while two creation dialogs are open, then both close during model work',
      should: 'wait across questions, respect the other tab, and restart only when the last request finishes',
      actual: { betweenQuestions, otherTab, generating, after: codes },
      expected: { betweenQuestions: [], otherTab: [], generating: [], after: [RELOAD_EXIT_CODE] },
    })
  } finally {
    finish.resolve()
    for (const id of sessions) await activity(id, false)
    gate.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('MI progress reaches the browser before the result, and streaming failures stay explicit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mi-progress-'))
  const finish = Promise.withResolvers<void>()
  const ai: MostImportantAI = {
    suggest: async (_day, _input, progress) => {
      progress?.({ stage: 'context' })
      progress?.({ stage: 'thinking', documents: 12 })
      await finish.promise
      progress?.({ stage: 'writing' })
      return {
        contextSummary: 'A clear next step.',
        suggestions: [{ summary: 'Review Atlas', reason: 'Unblock the proposal.' }],
      }
    },
    question: async () => null,
    draft: async (_day, _input, progress) => {
      progress?.({ stage: 'thinking', documents: 12 })
      throw new Error('The model is unavailable. Try again.')
    },
  }
  const timeDir = path.join(root, 'time')
  const app = createDayRoutes({ markdownBaseDir: root, timeDir, today: () => DAY, mostImportant: ai })
  const request = (action: string, body: unknown) =>
    app.request(`/${DAY.ymd}/mi/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
  try {
    const response = await request('suggest', {})
    const stream = frames(response, 1000)
    const early = [await stream.next(), await stream.next(), await stream.next()]
    assert({
      given: 'the suggestion model has not returned yet',
      should: 'already expose real context and thinking stages',
      actual: early.map((item) => item.value),
      expected: [
        { event: 'started', data: {} },
        { event: 'progress', data: { stage: 'context' } },
        { event: 'progress', data: { stage: 'thinking', documents: 12 } },
      ],
    })
    finish.resolve()
    const completed: string[] = []
    for await (const frame of stream) completed.push(frame.event)
    const failed: Frame[] = []
    for await (const frame of frames(await request('draft', { statement: 'Review Atlas', answers: [] }), 1000))
      failed.push(frame)
    assert({
      given: 'a successful streamed shortlist followed by a failed draft request',
      should: 'finish with one result or a useful error, without saving a day',
      actual: {
        completed,
        failure: failed.at(-1),
        saved: await readFile(path.join(timeDir, dayFile(DAY)), 'utf8').catch(() => null),
      },
      expected: {
        completed: ['progress', 'result'],
        failure: { event: 'error', data: { error: 'The model is unavailable. Try again.' } },
        saved: null,
      },
    })
  } finally {
    finish.resolve()
    await rm(root, { recursive: true, force: true })
  }
})

test('MI routes keep generation unsaved, carry answers and edits into refinement, then accept once', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mi-routes-'))
  const inputs: MIDraftInput[] = []
  const ai: MostImportantAI = {
    suggest: async () => ({ contextSummary: 'Start with your own priority.', suggestions: [] }),
    question: async (_day, input) =>
      input.answers.length ? null : 'Should Jane review the pricing or the whole proposal?',
    draft: async (_day, input) => {
      inputs.push(input)
      return { ...DRAFT, ...input.previous }
    },
  }
  const timeDir = path.join(root, 'time')
  const app = createDayRoutes({
    markdownBaseDir: root,
    timeDir,
    today: () => DAY,
    mostImportant: ai,
    files: { markdownBaseDir: root, timeDir, userDataDir: path.join(root, 'state') },
  })
  const post = (action: string, body: unknown, origin?: string) =>
    app.request(`/${DAY.ymd}/mi/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    })
  try {
    const suggestions = await (await post('suggest', {})).json()
    const interview = {
      statement: 'Get Atlas ready',
      answers: [
        {
          question: 'Should Jane review the pricing or the whole proposal?',
          answer: 'Just pricing; the rest is already agreed.',
        },
      ],
    }
    await post('draft', interview)
    const edited = { ...DRAFT, body: DRAFT.body + '\n## Scope\n\nPricing only.\n' }
    await post('draft', { ...interview, previous: edited, feedback: 'Explain why early feedback will help.' })
    const before = await readFile(path.join(timeDir, dayFile(DAY)), 'utf8').catch(() => null)
    const request = { draft: edited, requestId: crypto.randomUUID() }
    const accepted = (await (await post('save', request)).json()) as {
      saved: { file: string }
      view: { record: { mostImportant: Array<{ raw: string; time: string | null }> } }
    }
    const retry = (await (await post('save', request)).json()) as typeof accepted
    const item = accepted.view.record.mostImportant[0]
    const toggled = await app.request(`/${DAY.ymd}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'Most Important', raw: item.raw, done: true }),
    })
    const saved = await readFile(path.join(timeDir, path.dirname(dayFile(DAY)), accepted.saved.file), 'utf8')
    assert({
      given: 'a new notebook, interview, refinement, acceptance retry, and day checkbox',
      should: 'save only the final document and synchronize completion',
      actual: {
        suggestions,
        unsaved: before === null,
        answers: inputs[0].answers,
        previous: inputs[1].previous,
        one: retry.view.record.mostImportant.length,
        same: accepted.saved.file === retry.saved.file,
        time: item.time,
        toggleStatus: toggled.status,
        complete: saved.includes('complete: true'),
        scope: saved.includes('Pricing only.'),
        transcript: saved.includes(interview.answers[0].answer),
      },
      expected: {
        suggestions: { contextSummary: 'Start with your own priority.', suggestions: [] },
        unsaved: true,
        answers: interview.answers,
        previous: { ...edited, body: edited.body.trim() },
        one: 1,
        same: true,
        time: null,
        toggleStatus: 200,
        complete: true,
        scope: true,
        transcript: false,
      },
    })
    await writeFile(
      path.join(timeDir, dayFile(DAY)),
      (await readFile(path.join(timeDir, dayFile(DAY)), 'utf8')).replace('---\n', '---\nended: 18:00\n'),
    )
    const ended = await post('save', { draft: DRAFT, requestId: crypto.randomUUID() })
    const crossSite = await post('draft', interview, 'https://example.com')
    const malformed = await post('save', {
      draft: { ...DRAFT, summary: 'Title\n## Another task' },
      requestId: crypto.randomUUID(),
    })
    assert({
      given: 'an ended day, a foreign origin, and a multiline title',
      should: 'refuse the writes',
      actual: [ended.status, crossSite.status, malformed.status],
      expected: [409, 403, 400],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
