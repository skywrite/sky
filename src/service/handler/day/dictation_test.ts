import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import OpenAI from 'openai'
import { makeTempDir } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDictationRoutes } from './dictation.ts'

test('entry dictation issues a short-lived transcription credential only for an editable day', async () => {
  const dir = await makeTempDir({ prefix: 'sky-entry-dictation-' })
  const date = new PlainDate('2026-01-27')
  const issued: unknown[] = []
  const client = new OpenAI({
    apiKey: 'synthetic-project-key',
    fetch: async (input, init) => {
      issued.push(await new Request(input, init).json())
      return Response.json({ value: 'synthetic-client-secret', session: { id: 'synthetic-session' } })
    },
  })
  const app = createDictationRoutes(dir, async () => client)
  const request = (headers: Record<string, string> = {}, ymd = date.ymd) =>
    app.request(`/${ymd}/item/dictation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'untrusted-model' }),
    })
  try {
    const good = await request()
    const summary = daySummaryPath(path.join(dir, dayFile(date)))
    await mkdir(path.dirname(summary), { recursive: true })
    await writeFile(summary, '# Summary\n')
    const refused = await Promise.all([
      request(),
      request({ origin: 'https://example.com' }),
      request({ 'content-type': 'text/plain' }),
      request({}, '2026-02-30'),
    ])
    assert({
      given: 'an editable date and requests from a summarized day, another origin, or an invalid form',
      should: 'only mint the server-selected transcription session and return its non-cacheable client credential',
      actual: [good.status, await good.json(), good.headers.get('cache-control'), refused.map((r) => r.status), issued],
      expected: [
        200,
        { value: 'synthetic-client-secret' },
        'no-store',
        [409, 403, 400, 400],
        [
          {
            expires_after: { anchor: 'created_at', seconds: 60 },
            session: {
              type: 'transcription',
              audio: { input: { transcription: { model: 'gpt-live-transcribe', delay: 'low' }, turn_detection: null } },
            },
          },
        ],
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('entry dictation tells the transcriber the notebook names and checks the finished text against them', async () => {
  const dir = await makeTempDir({ prefix: 'sky-entry-dictation-names-' })
  const sessions: Array<{ session: { audio: { input: { transcription: unknown } } } }> = []
  const reported: Array<{ source: string; stage?: string; message: string }> = []
  const client = new OpenAI({
    apiKey: 'synthetic-project-key',
    fetch: async (input, init) => {
      sessions.push(await new Request(input, init).json())
      return Response.json({ value: 'synthetic-client-secret', session: { id: 'synthetic-session' } })
    },
  })
  let listReadable = true
  const names = {
    keywords: async () => {
      if (!listReadable) throw new Error('saved corrections unreadable')
      return ['Jane Doe', 'Atlas Console']
    },
    correct: async (text: string) => {
      if (text.includes('fail')) throw new Error('model unavailable')
      return text.replace('Jane Doh', 'Jane Doe')
    },
  }
  const app = createDictationRoutes(
    dir,
    async () => client,
    names,
    async (entry) => void reported.push(entry),
  )
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/2026-01-27/item/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  try {
    const started = await post('dictation', {})
    listReadable = false
    const startedWithoutList = await post('dictation', {})
    const fixed = await post('dictation/names', { text: "Review Jane Doh's plan" })
    const failed = await post('dictation/names', { text: 'this will fail' })
    const refused = await Promise.all([
      post('dictation/names', { text: 'Review the plan' }, { origin: 'https://example.com' }),
      post('dictation/names', { text: 'Review the plan' }, { 'content-type': 'text/plain' }),
      post('dictation/names', { words: 'Review the plan' }),
    ])
    const unchecked = await createDictationRoutes(dir, async () => client).request('/2026-01-27/item/dictation/names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: "Review Jane Doh's plan" }),
    })
    assert({
      given: 'a day page that knows its names, then a names list that cannot be read',
      should: 'start dictation with the names as keywords, and still start it without them',
      actual: [
        started.status,
        sessions[0]?.session.audio.input.transcription,
        startedWithoutList.status,
        sessions[1]?.session.audio.input.transcription,
        reported[0],
      ],
      expected: [
        200,
        { model: 'gpt-live-transcribe', delay: 'low', keywords: ['Jane Doe', 'Atlas Console'] },
        200,
        { model: 'gpt-live-transcribe', delay: 'low' },
        { source: 'day:dictation', stage: 'keywords', message: 'saved corrections unreadable' },
      ],
    })
    assert({
      given:
        'finished text with a misheard name, a check that fails, requests from elsewhere, and a page with no names',
      should:
        'return the corrected text, say plainly when names went unchecked, refuse outsiders, and pass text through',
      actual: [
        [fixed.status, await fixed.json(), fixed.headers.get('cache-control')],
        [failed.status, await failed.json(), reported[1]],
        refused.map((response) => response.status),
        [unchecked.status, await unchecked.json()],
      ],
      expected: [
        [200, { text: "Review Jane Doe's plan" }, 'no-store'],
        [
          502,
          { error: 'Sky could not check the names in this text. Review them before saving.' },
          { source: 'day:dictation:names', stage: 'check', message: 'model unavailable' },
        ],
        [403, 400, 400],
        [200, { text: "Review Jane Doh's plan" }],
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
