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
