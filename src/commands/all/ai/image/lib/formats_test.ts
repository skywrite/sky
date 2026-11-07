import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import OpenAI from 'openai'
import { assert, test } from '#test'
import { writeImageEvidence } from './evidence.ts'
import { IMAGE_FORMATS, validateImageOutput } from './options.ts'
import { renderImages } from './render.ts'

test('Native formats retain provider bytes, format parameters and correctly named evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-image-formats-'))
  try {
    for (const format of IMAGE_FORMATS) {
      const data =
        format === 'svg'
          ? '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>'
          : `synthetic ${format} bytes`
      let body: Record<string, unknown> = {}
      const client = new OpenAI({
        apiKey: 'mock-api-key',
        baseURL: 'https://example.com/v1',
        fetch: async (url, init) => {
          const request = new Request(url, init)
          body = await request.json()
          return Response.json({ created: 0, data: [{ b64_json: Buffer.from(data).toString('base64') }] })
        },
      })
      const [image] = await renderImages(
        {
          prompt: 'An Atlas lantern.',
          model: 'gpt-image-2.6-flare',
          quality: 'high',
          count: 1,
          refs: [],
          format,
          ...(format === 'gif' ? { frameCount: 9, frameDurationMs: 200 } : {}),
        },
        client,
      )
      const evidence = await writeImageEvidence(path.join(root, `Atlas.${format}`), image!, {
        prompt: 'An Atlas lantern.',
        model: 'gpt-image-2.6-flare',
        quality: 'high',
        format,
      })
      assert({
        given: `${format} generation`,
        should: 'send the native format and preserve its bytes with a truthful extension',
        actual: [
          body.output_format,
          body.frame_count ?? null,
          body.frame_duration_ms ?? null,
          Buffer.from(image!.data).toString(),
          await readFile(path.join(evidence.directory, `selected.${format}`), 'utf8'),
        ],
        expected: [format, format === 'gif' ? 9 : null, format === 'gif' ? 200 : null, data, data],
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Unsupported edit formats and animation combinations fail locally', () => {
  const base = { format: 'png', references: 0, count: 1 }
  const invalid = [
    { format: 'svg', references: 1 },
    { format: 'gif', references: 1 },
    { format: 'svg', count: 2 },
    { format: 'png', frameCount: 9 },
    { format: 'gif', frameCount: 17 },
    { format: 'gif', frameDurationMs: 0 },
    { format: 'jpeg', background: 'transparent' },
    { markup: true },
    { markup: true, mask: true, references: 1 },
    { format: 'gif', reviewed: true },
    { format: 'webp', method: 'mixed' },
    { complexity: 'extreme' },
  ]
  assert({
    given: 'format options that cannot be combined',
    should: 'return actionable validation errors before any paid call',
    actual: invalid.map((options) => !!validateImageOutput({ ...base, ...options })),
    expected: invalid.map(() => true),
  })
  assert({
    given: 'a small animation and a marked WebP photo',
    should: 'allow each supported native request',
    actual: [
      validateImageOutput({ ...base, format: 'gif', frameCount: 16, frameDurationMs: 200, size: '256x256' }),
      validateImageOutput({ ...base, format: 'webp', references: 1, markup: true }),
    ],
    expected: [null, null],
  })
})
