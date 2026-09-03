import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { PromptEvent, RunEvent } from '#commands/lib/core/runCommand.ts'
import type { PromptRequest } from '#commands/lib/prompt/Prompter.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { ImportEvent, ImportJob, ImportRoutesOptions, RunOutcome } from './mod.ts'
import { readAudio, readTranscript, readUnknown } from './readback.ts'

// The routes over a scripted world: the read-back is real (it is pure), the
// listen, the calendar and the run are scripted.

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Jane Doe: Morning, everyone.

2
00:00:04.500 --> 00:46:30.000
Alex Chen: Shall we start with pricing?
`

const FILED = 'time/2026/W05/01-27/actions/meetings/0931_Zoom_Jane-Doe_Atlas-pricing-sync.md'

interface World {
  options: ImportRoutesOptions
  runs: ImportJob[]
  /** The next run asks these questions, in order, and returns this; the record says what an earlier run left */
  script: {
    ask: Array<'text' | 'form' | 'multiselect'>
    outcome: 'filed' | 'failed'
    resume: { step: string; started: string } | null
  }
}

async function world(): Promise<World & { dir: string; notebook: string }> {
  const notebook = await makeTempDir()
  const dir = path.join(notebook, '.user-data', 'imports')
  const runs: ImportJob[] = []
  const script: World['script'] = { ask: [], outcome: 'filed', resume: null }
  const options: ImportRoutesOptions = {
    dir,
    journalTypes: ['Reflection', 'Mood'],
    read: async ({ path: filePath, name, size }) => {
      if (name.endsWith('.vtt')) return readTranscript(await readFile(filePath, 'utf8'), name)
      if (name.endsWith('.m4a')) return readAudio(size, 252)
      return readUnknown(name)
    },
    suggestWhen: () => '2026-01-27 09:31',
    // Keyed by name here rather than by bytes; what is left to pick up is scripted.
    record: async ({ path: filePath, key }) => ({
      key: key ?? `k-${path.basename(filePath)}`,
      resume: script.resume,
    }),
    listen: async () => ({ kind: 'meeting', opening: 'Okay, quick recap…', guess: 'Sounds like a meeting recap.' }),
    calendar: async () => ({
      title: 'Atlas pricing sync',
      start: '09:30',
      end: '10:15',
      who: ['Jane Doe'],
      relation: 'matches',
    }),
    run: async function* (
      job: ImportJob,
      filePath: string,
      signal: AbortSignal,
    ): AsyncGenerator<RunEvent, RunOutcome, void> {
      runs.push(job)
      let n = 0
      // A question the way the runner asks it: an event carrying its reply, answered null on cancel.
      const question = (request: PromptRequest): { event: PromptEvent; answered: Promise<unknown> } => {
        let reply!: (answer: unknown) => void
        const answered = new Promise<unknown>((resolve) => {
          reply = (answer) => resolve(answer)
        })
        signal.addEventListener('abort', () => reply(null), { once: true })
        return { event: { type: 'prompt', id: `p${++n}`, request, reply }, answered }
      }
      yield {
        type: 'plan',
        steps: [
          { id: 'transcribe', label: 'Transcribing' },
          { id: 'file', label: 'Filing' },
        ],
        command: 'meeting:new',
        depth: 1,
      }
      yield {
        type: 'stage',
        id: 'transcribe',
        label: 'Transcribing',
        detail: 'OpenAI',
        command: 'audio:transcript:create',
        depth: 2,
      }
      yield { type: 'line', text: `Transcribing: ${path.basename(filePath)}`, level: 'log', command: null, depth: 2 }
      yield { type: 'text', text: 'Okay, quick recap ', command: null, depth: 2 }
      yield { type: 'tick', done: 1, total: 2, unit: 'parts', command: null, depth: 2 }
      for (const ask of script.ask) {
        const q =
          ask === 'text'
            ? question({ kind: 'text', prompt: { message: 'Any corrections? (Enter to accept, or type changes)' } })
            : ask === 'form'
              ? question({
                  kind: 'form',
                  prompt: {
                    title: 'Interactive Review',
                    items: [
                      {
                        id: '0',
                        label: 'Name spelling',
                        problem: 'Jan Doh',
                        contexts: ['…Jan Doh on…'],
                        occurrences: 1,
                        suggestion: 'Jane Doe',
                        alternatives: [],
                      },
                    ],
                  },
                })
              : question({
                  kind: 'multiselect',
                  prompt: { message: 'Accept action items', options: [{ value: '0', label: 'Send the sheet' }] },
                })
        yield q.event
        const answer = await q.answered
        if (answer === null) return { ok: false, message: 'cancelled' }
      }
      yield { type: 'stage', id: 'file', label: 'Filing', detail: null, command: 'meeting:new', depth: 1 }
      return script.outcome === 'filed'
        ? { ok: true, file: FILED }
        : { ok: false, message: "Couldn't write the summary — it timed out after 20 minutes." }
    },
  }
  return { options, runs, script, dir, notebook }
}

function upload(name: string, body: string | Uint8Array, lastModified?: number): FormData {
  const form = new FormData()
  form.append('file', new File([body as BlobPart], name))
  if (lastModified) form.append('lastModified', String(lastModified))
  return form
}

/** Read the SSE stream until an event satisfies `until`, or the stream ends. */
async function events(response: Response, until: (e: ImportEvent) => boolean): Promise<ImportEvent[]> {
  const seen: ImportEvent[] = []
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const data = frame
        .split('\n')
        .find((l) => l.startsWith('data:'))
        ?.slice(5)
        .trim()
      if (!data) continue
      const event = JSON.parse(data) as ImportEvent
      seen.push(event)
      if (until(event)) {
        await reader.cancel()
        return seen
      }
    }
  }
  return seen
}

async function postJson(app: ReturnType<typeof createTestHttpApp>, url: string, body: unknown): Promise<Response> {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('POST /import stages a transcript and reads it back', async () => {
  const w = await world()
  const app = createTestHttpApp([path.join(w.notebook, 'time')], {
    imports: w.options,
    userDataDir: path.join(w.notebook, '.user-data'),
  })
  const response = await app.request('/import', {
    method: 'POST',
    body: upload('atlas-pricing-sync.vtt', VTT, 1_700_000_000_000),
  })
  const body = (await response.json()) as { job: ImportJob; options: { journalTypes: string[] } }
  // A write may be in flight; only what has landed counts.
  const staged = (await readdir(path.join(w.dir, body.job.id))).filter((f) => !f.endsWith('.tmp'))
  assert({
    given: 'a .vtt dropped',
    should: 'stage it, read it back, and offer it as a new meeting',
    actual: {
      status: response.status,
      state: body.job.state,
      summary: body.job.readback.summary,
      detail: body.job.readback.detail,
      kinds: body.job.readback.kinds,
      title: body.job.title,
      when: body.job.suggestedWhen,
      lastModified: body.job.file.lastModified,
      staged: staged.sort(),
      journalTypes: body.options.journalTypes,
    },
    expected: {
      status: 201,
      state: 'new',
      summary: 'Zoom transcript · 47 minutes · 2 turns',
      detail: 'Jane Doe, Alex Chen',
      kinds: ['meeting'],
      title: 'atlas-pricing-sync',
      when: '2026-01-27 09:31',
      lastModified: 1_700_000_000_000,
      staged: ['atlas-pricing-sync.vtt', 'job.json'],
      journalTypes: ['Reflection', 'Mood'],
    },
  })
  const list = (await (await app.request('/import')).json()) as { imports: ImportJob[] }
  assert({
    given: 'the list afterwards',
    should: 'hold the one job',
    actual: list.imports.map((j) => [j.id, j.state]),
    expected: [[body.job.id, 'new']],
  })
})

test('POST /import refuses a file sky does not take, and start refuses it too', async () => {
  const w = await world()
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const response = await app.request('/import', { method: 'POST', body: upload('deck.pdf', 'not really a pdf') })
  const { job } = (await response.json()) as { job: ImportJob }
  const start = await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })
  assert({
    given: 'a .pdf',
    should: 'be a failed job with the sentence, which cannot be started',
    actual: [job.state, job.error, start.status],
    expected: [
      'failed',
      "Sky doesn't take .pdf files. Drop a Zoom transcript (.vtt), a voice memo, a notetaker's .txt, or a screenshot of a conversation.",
      400,
    ],
  })
  const empty = await app.request('/import', { method: 'POST', body: upload('empty.vtt', '') })
  assert({ given: 'an empty file', should: 'be refused outright', actual: empty.status, expected: 400 })
})

test('a recording is heard and matched to the calendar before it starts', async () => {
  const w = await world()
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const response = await app.request('/import', { method: 'POST', body: upload('memo.m4a', new Uint8Array(1000)) })
  const { job } = (await response.json()) as { job: ImportJob }
  const seen = await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'calendar')
  const snapshot = (await (await app.request(`/import/${job.id}`)).json()) as { job: ImportJob }
  assert({
    given: 'an audio file',
    should: 'offer every kind, then say what it heard and what the calendar says',
    actual: {
      kinds: job.readback.kinds.length,
      title: job.title,
      types: seen.map((e) => e.type).sort(),
      listen: snapshot.job.listen?.guess,
      calendar: snapshot.job.calendar?.title,
    },
    expected: {
      kinds: 5,
      title: 'Voice memo 9:31',
      types: ['calendar', 'listen'],
      listen: 'Sounds like a meeting recap.',
      calendar: 'Atlas pricing sync',
    },
  })
  const bad = await postJson(app, `/import/${job.id}/start`, { kind: 'journal', when: '2026-01-27 09:31' })
  assert({
    given: 'a journal without a type',
    should: 'be refused',
    actual: [bad.status, ((await bad.json()) as { message: string }).message],
    expected: [400, 'a journal needs a type'],
  })
})

test('start runs the door, streams its output, parks its questions, and files', async () => {
  const w = await world()
  w.script.ask = ['form', 'text', 'multiselect']
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const { job } = (await (await app.request('/import', { method: 'POST', body: upload('atlas.vtt', VTT) })).json()) as {
    job: ImportJob
  }

  const started = await postJson(app, `/import/${job.id}/start`, {
    kind: 'meeting',
    when: '2026-01-27 09:31',
    category: 'Personal',
  })
  const startedJob = ((await started.json()) as { job: ImportJob }).job
  const again = await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })

  // The stream replays everything so far and waits at the first question.
  const first = await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'prompt')
  const prompt = first.find((e) => e.type === 'prompt')
  const waiting = ((await (await app.request(`/import/${job.id}`)).json()) as { job: ImportJob }).job
  assert({
    given: 'a started import',
    should: "carry the dialog's fields, refuse a second start, and be waiting at its first question",
    actual: {
      state: waiting.state,
      fields: startedJob.fields,
      again: again.status,
      types: first.map((e) => e.type),
      stage: first.find((e) => e.type === 'stage'),
      promptKind: prompt?.type === 'prompt' ? prompt.prompt.kind : null,
      run: w.runs[0]?.fields?.category,
      plan: waiting.plan?.map((s) => s.id) ?? null,
      line: waiting.line,
    },
    expected: {
      // Read after the first question arrived: the run's events land over the stream, after the start answers.
      state: 'needs-you',
      fields: { kind: 'meeting', when: '2026-01-27 09:31', category: 'Personal', journalType: null, fresh: false },
      again: 409,
      // The calendar match arrived before the start and stays at the head of the replay.
      types: ['calendar', 'state', 'plan', 'stage', 'line', 'text', 'tick', 'prompt'],
      stage: { seq: 4, type: 'stage', stage: { id: 'transcribe', label: 'Transcribing', detail: 'OpenAI' } },
      promptKind: 'form',
      run: 'Personal',
      // The plan and the progress line land on the job as the stream is read.
      plan: ['transcribe', 'file'],
      line: 'Needs you · Interactive Review',
    },
  })

  const wrong = await postJson(app, `/import/${job.id}/answer`, { promptId: 'nope', answer: {} })
  const promptId = prompt?.type === 'prompt' ? prompt.prompt.id : ''
  const answered = await postJson(app, `/import/${job.id}/answer`, {
    promptId,
    answer: { '0': { action: 'accept', value: 'Jane Doe' } },
  })
  const second = await events(
    await app.request(`/import/${job.id}/events`),
    (e) => e.type === 'prompt' && e.prompt.kind === 'text',
  )
  const textPrompt = second.filter((e) => e.type === 'prompt').at(-1)
  await postJson(app, `/import/${job.id}/answer`, {
    promptId: textPrompt?.type === 'prompt' ? textPrompt.prompt.id : '',
    answer: '',
  })
  const third = await events(
    await app.request(`/import/${job.id}/events`),
    (e) => e.type === 'prompt' && e.prompt.kind === 'multiselect',
  )
  const multi = third.filter((e) => e.type === 'prompt').at(-1)
  await postJson(app, `/import/${job.id}/answer`, {
    promptId: multi?.type === 'prompt' ? multi.prompt.id : '',
    answer: ['0'],
  })
  const settled = await events(
    await app.request(`/import/${job.id}/events`),
    (e) => e.type === 'state' && e.state === 'done',
  )
  const done = settled.at(-1)
  const snapshot = ((await (await app.request(`/import/${job.id}`)).json()) as { job: ImportJob }).job
  assert({
    given: 'answers to each question in turn',
    should: 'refuse an unknown id, carry each answer in, and settle as done with what was filed',
    actual: {
      wrong: wrong.status,
      answered: answered.status,
      done: done?.type === 'state' ? [done.state, done.result?.file] : null,
      state: snapshot.state,
      line: snapshot.line,
      replay: settled.filter((e) => e.type === 'answered').length,
    },
    expected: {
      wrong: 404,
      answered: 200,
      done: ['done', FILED],
      state: 'done',
      line: 'Filed · 0931_Zoom_Jane-Doe_Atlas-pricing-sync',
      replay: 3,
    },
  })
})

test('a failed run is a sentence, and Start again reuses the file', async () => {
  const w = await world()
  w.script.outcome = 'failed'
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const { job } = (await (await app.request('/import', { method: 'POST', body: upload('atlas.vtt', VTT) })).json()) as {
    job: ImportJob
  }
  await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })
  const failed = await events(
    await app.request(`/import/${job.id}/events`),
    (e) => e.type === 'state' && e.state === 'failed',
  )
  w.script.outcome = 'filed'
  const restarted = await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 10:00' })
  const doneAgain = await events(
    await app.request(`/import/${job.id}/events`),
    (e) => e.type === 'state' && e.state === 'done',
  )
  const lastFailed = failed.at(-1)
  const lastDone = doneAgain.at(-1)
  assert({
    given: 'a run that fails, then a second start',
    should: 'show the failure sentence, then run again from the same file with the new when',
    actual: [
      lastFailed?.type === 'state' ? lastFailed.error : null,
      restarted.status,
      w.runs.length,
      w.runs[1]?.fields?.when,
      lastDone?.type === 'state' ? lastDone.state : null,
    ],
    expected: ["Couldn't write the summary — it timed out after 20 minutes.", 200, 2, '2026-01-27 10:00', 'done'],
  })
})

test('cancel answers the parked question with nothing, remove forgets the job', async () => {
  const w = await world()
  w.script.ask = ['text']
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const { job } = (await (await app.request('/import', { method: 'POST', body: upload('atlas.vtt', VTT) })).json()) as {
    job: ImportJob
  }
  await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })
  await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'prompt')
  const early = await postJson(app, `/import/${job.id}/remove`, {})
  const cancelled = await postJson(app, `/import/${job.id}/cancel`, {})
  const removed = await postJson(app, `/import/${job.id}/remove`, {})
  const gone = await app.request(`/import/${job.id}`)
  let dirLeft = true
  try {
    await readdir(path.join(w.dir, job.id))
  } catch {
    dirLeft = false
  }
  assert({
    given: 'a job waiting on a question',
    should: 'refuse removal while it waits, cancel cleanly, then remove the job and its file',
    actual: [
      early.status,
      ((await cancelled.json()) as { job: ImportJob }).job.state,
      removed.status,
      gone.status,
      dirLeft,
    ],
    expected: [409, 'cancelled', 200, 404, false],
  })
})

test('a service restart reads a running job as failed, file kept', async () => {
  const w = await world()
  w.script.ask = ['text']
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const { job } = (await (await app.request('/import', { method: 'POST', body: upload('atlas.vtt', VTT) })).json()) as {
    job: ImportJob
  }
  await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })
  await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'prompt')

  // The same directory, read by a fresh service.
  const reborn = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const list = (await (await reborn.request('/import')).json()) as { imports: ImportJob[] }
  const staged = await readdir(path.join(w.dir, job.id))
  assert({
    given: 'a job that was mid-way when the service died',
    should: 'read as failed with the restart sentence, the upload still there',
    actual: [list.imports[0]?.state, list.imports[0]?.error, staged.includes('atlas.vtt')],
    expected: ['failed', 'Sky restarted while this was running. The file is still here.', true],
  })
})

test('an earlier run of the file shows on the job, and Start over reaches the command', async () => {
  const w = await world()
  w.script.resume = { step: 'Writing it up', started: '2026-01-27 00:06' }
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const response = await app.request('/import', { method: 'POST', body: upload('atlas-pricing-sync.vtt', VTT) })
  const { job } = (await response.json()) as { job: ImportJob }
  const started = await postJson(app, `/import/${job.id}/start`, {
    kind: 'meeting',
    when: '2026-01-27 09:31',
    fresh: true,
  })
  await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'state' && e.state === 'done')
  assert({
    given: 'a file an earlier run got part way through, started over',
    should: 'carry the key and the earlier run on the job, and hand the command fresh',
    actual: {
      status: started.status,
      key: job.runKey,
      resume: job.resume,
      fresh: w.runs[0]?.fields?.fresh,
    },
    expected: {
      status: 200,
      key: 'k-atlas-pricing-sync.vtt',
      resume: { step: 'Writing it up', started: '2026-01-27 00:06' },
      fresh: true,
    },
  })
})

test('a run that stopped is looked at again when the job is opened', async () => {
  const w = await world()
  w.script.outcome = 'failed'
  const app = createTestHttpApp([path.join(w.notebook, 'time')], { imports: w.options })
  const response = await app.request('/import', { method: 'POST', body: upload('atlas-pricing-sync.vtt', VTT) })
  const { job } = (await response.json()) as { job: ImportJob }
  await postJson(app, `/import/${job.id}/start`, { kind: 'meeting', when: '2026-01-27 09:31' })
  await events(await app.request(`/import/${job.id}/events`), (e) => e.type === 'state' && e.state === 'failed')
  // What the run left behind is on disk by now; the next look at the job finds it.
  w.script.resume = { step: 'Checking names', started: '2026-01-27 09:31' }
  const opened = (await (await app.request(`/import/${job.id}`)).json()) as { job: ImportJob }
  assert({
    given: 'a run that failed, then the job opened again',
    should: 'show nothing to pick up at upload and the earlier run afterwards, with the key kept',
    actual: [job.resume, opened.job.resume, opened.job.runKey, w.runs[0]?.fields?.fresh],
    expected: [null, { step: 'Checking names', started: '2026-01-27 09:31' }, 'k-atlas-pricing-sync.vtt', false],
  })
})
