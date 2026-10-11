import { spyOn } from 'bun:test'
import { createOpenAI } from '@ai-sdk/openai'
import { GoogleClient, WORKSPACE_MIME, saveAccountTokens } from '#lib/google/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { getProfile, resolveProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { createAgentTools, createMissionState } from './tools.ts'

const PDF = '%PDF-1.4\n%%EOF'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII='

for (const selection of [
  { profile: 'default-gpt-6.1-sol-ultrafast', effort: 'medium', model: 'gpt-6.1-sol', tier: 'ultrafast' },
  { profile: 'default-gpt-6.1-sol-ultrafast', effort: 'high', model: 'gpt-6.1-sol', tier: 'ultrafast' },
  { profile: 'default-gpt-6-astra-high', effort: 'high', model: 'gpt-6-astra', tier: 'priority' },
] as const) {
  test(`visual reviews inherit ${selection.profile} at ${selection.effort} effort`, async () => {
    const requests: Array<Record<string, unknown>> = []
    const provider = createOpenAI({
      apiKey: 'mock-api-key',
      fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({
          id: 'review-test',
          model: selection.model,
          output: [
            {
              type: 'message',
              role: 'assistant',
              id: 'review-message',
              content: [{ type: 'output_text', text: 'OK', annotations: [] }],
            },
          ],
        })
      }) as typeof fetch,
    })
    const secrets = new TestSecretsProvider()
    await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
    const client = new GoogleClient({
      secrets,
      email: 'jane@example.com',
      client: { clientId: 'id', clientSecret: 'sec' },
      fetchFn: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname === '/drive/v3/files/doc1') {
          return Response.json({ id: 'doc1', name: 'Atlas overview', mimeType: WORKSPACE_MIME.doc })
        }
        if (url.pathname === '/drive/v3/files/doc1/export') return new Response(PDF)
        if (url.pathname.endsWith('/thumbnail')) {
          return Response.json({ contentUrl: 'https://example.com/slide.png' })
        }
        if (url.pathname === '/v1/presentations/deck1') {
          return Response.json({ presentationId: 'deck1', slides: [{ objectId: 'slide1' }, { objectId: 'slide2' }] })
        }
        throw new Error(`Unexpected Google API request: ${url.pathname}`)
      }) as typeof fetch,
    })
    const missionModel = resolveProfile(getProfile(selection.profile), { effort: selection.effort })
    const tools = createAgentTools({
      client,
      log: () => {},
      state: createMissionState(),
      missionModel: { ...missionModel, model: provider(selection.model) },
      critiquePrompt: 'Review this slide.',
      deckCritiquePrompt: 'Review this deck.',
      docCritiquePrompt: 'Review this document.',
    })
    const thumbnailFetch = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      if (String(input) !== 'https://example.com/slide.png') throw new Error('Unexpected external request')
      return new Response(Buffer.from(PNG, 'base64'))
    }) as typeof fetch)
    try {
      const results = [
        await tools.inspect_doc_visually.execute({ fileId: 'doc1' }),
        await tools.inspect_slide_visually.execute({ presentationId: 'deck1', slideObjectId: 'slide1' }),
        await tools.inspect_deck_visually.execute({ presentationId: 'deck1' }),
      ]
      assert({
        given: 'a mission selection shared by document, slide, and whole-deck reviews',
        should: 'send every review to the mission model with its actual effort and service tier',
        actual: {
          results,
          settings: requests.map((request) => [
            request.model,
            (request.reasoning as { effort: string }).effort,
            request.service_tier,
          ]),
        },
        expected: {
          results: [{ critique: 'OK' }, { critique: 'OK' }, { critique: 'OK', slidesReviewed: ['slide1', 'slide2'] }],
          settings: Array.from({ length: 3 }, () => [selection.model, selection.effort, selection.tier]),
        },
      })
      const reviews = requests.map((request) => {
        const input = request.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
        return {
          roles: input.map((message) => message.role),
          content: input.flatMap((message) => message.content),
        }
      })
      assert({
        given: 'rendered PDF pages and slide PNGs',
        should: 'preserve their bytes and give each critique a fresh user message',
        actual: reviews.map((review) => ({
          roles: review.roles,
          types: review.content.map((part) => part.type),
          files: review.content.flatMap((part) =>
            part.type === 'input_file' ? [part.file_data] : part.type === 'input_image' ? [part.image_url] : [],
          ),
        })),
        expected: [
          {
            roles: ['user'],
            types: ['input_file', 'input_text'],
            files: [`data:application/pdf;base64,${Buffer.from(PDF).toString('base64')}`],
          },
          { roles: ['user'], types: ['input_image', 'input_text'], files: [`data:image/png;base64,${PNG}`] },
          {
            roles: ['user'],
            types: ['input_text', 'input_image', 'input_text', 'input_image', 'input_text'],
            files: [`data:image/png;base64,${PNG}`, `data:image/png;base64,${PNG}`],
          },
        ],
      })
    } finally {
      thumbnailFetch.mockRestore()
    }
  })
}
