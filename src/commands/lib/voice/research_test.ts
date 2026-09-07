import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createOpenAI } from '@ai-sdk/openai'
import { MockLanguageModelV3 } from 'ai/test'
import { buildSchema, parse, validate } from 'graphql'
import { typeDefs } from '#service/graphql/schema.ts'
import { getProfile, type ModelProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createVoiceResearch, DEEP_VOICE_PROFILE, FAST_VOICE_PROFILE, voiceResearchProfile } from './research.ts'
import type { ResearchFetch } from './researchTools.ts'

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}
function call(id: string, toolName: string, input: unknown) {
  return {
    content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage: USAGE,
    warnings: [],
  }
}
function answer(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: USAGE,
    warnings: [],
  }
}
async function fixture(files: Record<string, string>, run: (base: string) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'voice-research-test-'))
  try {
    for (const [file, body] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true })
      await writeFile(path.join(base, file), body)
    }
    await run(base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}
const options = (base: string) => ({
  config: { DIR_BASE: base, PORT_SERVER: 4321 },
  systemPrompt: 'Initial notebook context: the user is planning Atlas.',
})

test('voice lookup uses Qwen without changing the shared profile and reads its search result', async () => {
  await fixture({ 'people/Jane-Doe.md': '# Jane Doe\nJane designs the Atlas pilot.' }, async (base) => {
    const profiles: ModelProfile[] = []
    const model = new MockLanguageModelV3({
      doGenerate: [
        call('s', 'search_notebook', { query: 'Jane Doe' }),
        call('r', 'read_file', { path: 'people/Jane-Doe.md' }),
        answer('Jane designs the Atlas pilot.'),
      ],
    })
    const engine = createVoiceResearch(options(base), {
      model: (profile) => {
        profiles.push(profile)
        return { model }
      },
      fetcher: async () =>
        Response.json({ results: [{ relativePath: 'people/Jane-Doe.md', title: 'Jane Doe', kind: 'person' }] }),
    })
    const before = structuredClone(getProfile(FAST_VOICE_PROFILE).options)
    const result = await engine.lookup('What does Jane do on Atlas?')
    assert({
      given: 'a fast lookup with a matching contact source',
      should: 'search, read, and return its grounded answer and source',
      actual: [
        result,
        model.doGenerateCalls.length,
        profiles[0].provider,
        profiles[0].options,
        getProfile(FAST_VOICE_PROFILE).options,
      ],
      expected: [
        { status: 'complete', answer: 'Jane designs the Atlas pilot.', paths: ['people/Jane-Doe.md'] },
        3,
        'cerebras',
        { ...before, reasoningEffort: 'none' },
        before,
      ],
    })
    assert({
      given: 'an explicit alternative model profile',
      should: 'preserve its provider settings',
      actual: [voiceResearchProfile(DEEP_VOICE_PROFILE, true), voiceResearchProfile(DEEP_VOICE_PROFILE, true, 'web')],
      expected: [getProfile(DEEP_VOICE_PROFILE), getProfile(DEEP_VOICE_PROFILE)],
    })
  })
})

test('Sunny learns a lead from a read, follows it with a structured query, and compares the next source', async () => {
  await fixture(
    {
      'notes/atlas.md': '# Atlas\nThe timeline changed after the Harbor review.',
      'notes/harbor.md': '# Harbor review\nThe pilot moved to April after the capacity review.',
    },
    async (base) => {
      const queries: string[] = []
      let sawLead = false
      let sawSecondSource = false
      let step = 0
      const model = new MockLanguageModelV3({
        doGenerate: async (input) => {
          switch (step++) {
            case 0:
              return call('s', 'search_notebook', { query: 'Atlas' })
            case 1:
              return call('r', 'read_file', { path: 'notes/atlas.md' })
            case 2:
              sawLead = JSON.stringify(input.prompt).includes('timeline changed after the Harbor review')
              return call('q', 'query_notebook', {
                bodyContains: 'Harbor',
                dateGte: '2026-01-01',
                dateLte: '2026-03-31',
              })
            case 3:
              return call('r2', 'read_file', { path: 'notes/harbor.md' })
            default:
              sawSecondSource = JSON.stringify(input.prompt).includes('pilot moved to April')
              return answer('The capacity review moved the Atlas pilot to April.')
          }
        },
      })
      let profile: ModelProfile | undefined
      const engine = createVoiceResearch(options(base), {
        model: (chosen) => {
          profile = chosen
          return { model }
        },
        fetcher: async (url, init) => {
          if (url.endsWith('/graphql')) {
            queries.push(JSON.parse(String(init?.body)).query)
            return Response.json({ data: { documents: [{ path: path.join(base, 'notes/harbor.md'), type: 'note' }] } })
          }
          return Response.json({ results: [{ relativePath: 'notes/atlas.md', title: 'Atlas', kind: 'doc' }] })
        },
      })
      const result = await engine.research('Why did Atlas move?')
      assert({
        given: 'a new lead found only inside the first source',
        should: 'carry it into a followup query and synthesize both reads with Astra',
        actual: [sawLead, sawSecondSource, result.paths, model.doGenerateCalls.length, profile?.model],
        expected: [true, true, ['notes/atlas.md', 'notes/harbor.md'], 5, 'gpt-6-astra'],
      })
      assert({
        given: 'the generated structured query',
        should: 'validate against the real schema with literal date and topic filters',
        actual: [
          queries.length,
          queries.flatMap((query) => validate(buildSchema(typeDefs), parse(query)).map((error) => error.message)),
          queries[0].includes('dateGte: "2026-01-01"'),
        ],
        expected: [1, [], true],
      })
    },
  )
})

test('voice research distinguishes failed search from empty evidence and blocks ungrounded final text', async () => {
  for (const fail of [false, true]) {
    const model = new MockLanguageModelV3({
      doGenerate: [call('s', 'search_notebook', { query: 'Atlas' }), answer('Invented outcome.')],
    })
    const engine = createVoiceResearch(options('/mock-notebook'), {
      model: () => ({ model }),
      fetcher: async () => (fail ? new Response('offline', { status: 503 }) : Response.json({ results: [] })),
    })
    const result = await engine.lookup('What happened to Atlas?')
    assert({
      given: fail ? 'an unavailable service' : 'an empty search',
      should: 'report the evidence limitation instead of an invented answer',
      actual: [
        result.paths,
        result.answer.includes(fail ? 'unavailable sources' : 'no readable source evidence'),
        result.answer.includes('Invented'),
      ],
      expected: [[], true, false],
    })
  }
})

test('voice research rejects traversal, absolute paths, and symlinks outside the notebook', async () => {
  await fixture({ 'outside.md': 'PRIVATE MOCK DATA', 'notebook/inside.md': 'Allowed mock data.' }, async (base) => {
    const notebook = path.join(base, 'notebook')
    await symlink(path.join(base, 'outside.md'), path.join(notebook, 'escape.md'))
    const model = new MockLanguageModelV3({
      doGenerate: [
        call('r1', 'read_file', { path: '../outside.md' }),
        call('r2', 'read_file', { path: path.join(base, 'outside.md') }),
        call('r3', 'read_file', { path: 'escape.md' }),
        answer('No safe source read.'),
      ],
    })
    const result = await createVoiceResearch(options(notebook), { model: () => ({ model }) }).research(
      'Read the source.',
    )
    assert({
      given: 'three ways to name a file outside the notebook',
      should: 'read none of them and never expose its contents to the model',
      actual: [result.paths, JSON.stringify(model.doGenerateCalls).includes('PRIVATE MOCK DATA')],
      expected: [[], false],
    })
  })
})

test('voice research reads bounded continuations and preserves the source path once', async () => {
  await fixture({ 'notes/large.md': 'a'.repeat(20_000) + '\nThe later finding is here.' }, async (base) => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        call('r1', 'read_file', { path: 'notes/large.md' }),
        call('r2', 'read_file', { path: 'notes/large.md', offsetBytes: 20_000 }),
        answer('The later finding is here.'),
      ],
    })
    const result = await createVoiceResearch(options(base), { model: () => ({ model }) }).research(
      'Find the later passage.',
    )
    const afterFirst = JSON.stringify(model.doGenerateCalls[1].prompt)
    const afterSecond = JSON.stringify(model.doGenerateCalls[2].prompt)
    assert({
      given: 'a source longer than one read',
      should: 'mark truncation, allow continuation, and deduplicate the reported source',
      actual: [
        afterFirst.includes('nextOffsetBytes'),
        afterFirst.includes('The later finding'),
        afterSecond.includes('The later finding'),
        result.paths,
      ],
      expected: [true, false, true, ['notes/large.md']],
    })
  })
})

test('voice lookup reserves its last step for synthesis', async () => {
  await fixture({ 'notes/atlas.md': 'A mock source.' }, async (base) => {
    let lastChoice: unknown
    let step = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (input) => {
        if (++step < 4) return call(`r${step}`, 'read_file', { path: 'notes/atlas.md' })
        lastChoice = input.toolChoice
        return answer('The available source says this is a mock.')
      },
    })
    await createVoiceResearch(options(base), { model: () => ({ model }) }).lookup('Read Atlas.')
    assert({
      given: 'a model that keeps reading until the last allowed step',
      should: 'disable tools on the fourth call so it can answer within the budget',
      actual: [step, lastChoice],
      expected: [4, { type: 'none' }],
    })
  })
})

test('voice research propagates cancellation before and during notebook search', async () => {
  const early = new AbortController()
  early.abort()
  let calls = 0
  let earlyAborted = false
  try {
    await createVoiceResearch(options('/mock-notebook'), {
      model: () => {
        calls++
        throw new Error('Must not resolve model')
      },
    }).lookup('Atlas', early.signal)
  } catch (error) {
    earlyAborted = (error as Error).name === 'AbortError'
  }
  const active = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const fetcher: ResearchFetch = async (_url, init) => {
    started()
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
    )
  }
  const model = new MockLanguageModelV3({ doGenerate: [call('s', 'search_notebook', { query: 'Atlas' })] })
  const pending = createVoiceResearch(options('/mock-notebook'), { model: () => ({ model }), fetcher }).research(
    'Atlas',
    active.signal,
  )
  await ready
  active.abort()
  let activeAborted = false
  try {
    await pending
  } catch (error) {
    activeAborted = (error as Error).name === 'AbortError'
  }
  assert({
    given: 'a cancelled question before startup or while a service call is pending',
    should: 'cancel model work and propagate AbortError without a spurious answer',
    actual: [earlyAborted, calls, activeAborted],
    expected: [true, 0, true],
  })
})

test('voice web lookup uses Qwen and page evidence without exposing initial notebook context', async () => {
  let webOnly = false
  let privateContextAbsent = false
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      if (step++ === 0) {
        webOnly = (input.tools ?? []).every((entry) => entry.name === 'web_search' || entry.name === 'read_web_page')
        privateContextAbsent = !JSON.stringify(input.prompt).includes('the user is planning Atlas')
        return call('s', 'web_search', { query: 'public standard explanation' })
      }
      return step === 2
        ? call('r', 'read_web_page', { url: 'https://example.com/standard' })
        : answer('Example Standards says the supported version is version two.')
    },
  })
  const profiles: ModelProfile[] = []
  const engine = createVoiceResearch(
    { ...options('/unused'), webApiKey: 'mock-api-key' },
    {
      model: (profile) => {
        profiles.push(profile)
        return { model }
      },
      fetcher: async (url) =>
        url.endsWith('/search')
          ? Response.json({
              results: [
                { title: 'Example Standards', url: 'https://example.com/standard', snippet: 'Version details' },
              ],
            })
          : new Response('Example Standards supports version two.', { headers: { 'content-type': 'text/plain' } }),
    },
  )
  const result = await engine.lookupWeb('What version does the public standard support?')
  assert({
    given: 'a public question with private notebook context available to other modes',
    should: 'use only web tools, omit private starting context, and retain the URL of a page actually read',
    actual: [
      result,
      webOnly,
      privateContextAbsent,
      profiles[0].options && 'reasoningEffort' in profiles[0].options ? profiles[0].options.reasoningEffort : undefined,
    ],
    expected: [
      {
        status: 'complete',
        answer: 'Example Standards says the supported version is version two.',
        paths: [],
        urls: ['https://example.com/standard'],
      },
      true,
      true,
      'low',
    ],
  })
})

test('Sunny web research follows a new public lead and compares pages using Astra', async () => {
  let learnedLead = false
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      switch (step++) {
        case 0:
          return call('s1', 'web_search', { query: 'example standard current version' })
        case 1:
          return call('r1', 'read_web_page', { url: 'https://example.com/standard' })
        case 2:
          learnedLead = JSON.stringify(input.prompt).includes(
            'See public migration guide Delta for the changed behavior.',
          )
          return call('s2', 'web_search', { query: 'example standard Delta migration' })
        case 3:
          return call('r2', 'read_web_page', { url: 'https://example.com/delta' })
        default:
          return answer(
            'Example Standards and its Delta guide say version two adds optional caching; version one has none.',
          )
      }
    },
  })
  const profiles: string[] = []
  const engine = createVoiceResearch(
    { ...options('/unused'), webApiKey: 'mock-api-key' },
    {
      model: (profile) => {
        profiles.push(profile.model)
        return { model }
      },
      fetcher: async (url, init) => {
        if (url.endsWith('/search')) {
          const query = JSON.parse(String(init?.body)).query as string
          return Response.json({
            results: [
              {
                title: 'Example Standards',
                url: query.includes('Delta') ? 'https://example.com/delta' : 'https://example.com/standard',
                snippet: 'Public version information',
              },
            ],
          })
        }
        return new Response(
          url.endsWith('/delta')
            ? 'Version two adds optional caching. Version one had none.'
            : 'See public migration guide Delta for the changed behavior.',
          { headers: { 'content-type': 'text/plain' } },
        )
      },
    },
  )
  const result = await engine.researchWeb('Compare the public standard versions using their documentation.')
  assert({
    given: 'a public page revealing a second relevant source',
    should: 'follow that new lead, read both sources, and return a grounded comparison',
    actual: [learnedLead, profiles, result.paths, result.urls, result.answer.includes('optional caching')],
    expected: [true, ['gpt-6-astra'], [], ['https://example.com/standard', 'https://example.com/delta'], true],
  })
})

test('voice web answers cannot pass the evidence guard after missing key, empty results, or blocked pages', async () => {
  const outcomes: unknown[] = []
  for (const kind of ['missing', 'empty', 'blocked']) {
    const model = new MockLanguageModelV3({
      doGenerate: [
        kind === 'blocked'
          ? call('r', 'read_web_page', { url: 'https://example.com/page' })
          : call('s', 'web_search', { query: 'public topic' }),
        answer('Unsupported invented success.'),
      ],
    })
    const engine = createVoiceResearch(
      { ...options('/unused'), webApiKey: kind === 'missing' ? undefined : 'mock-api-key' },
      {
        model: () => ({ model }),
        fetcher: async () => (kind === 'blocked' ? new Response('', { status: 403 }) : Response.json({ results: [] })),
      },
    )
    const result = await engine.lookupWeb(
      kind === 'blocked' ? 'Check the public topic at https://example.com/page' : 'Check the public topic on the web.',
    )
    outcomes.push([
      result.answer.includes('Unsupported invented'),
      result.answer.includes(
        kind === 'missing' ? 'PERPLEXITY_API_KEY' : kind === 'empty' ? 'no readable page evidence' : 'blocked access',
      ),
      result.paths,
      result.urls,
    ])
  }
  assert({
    given: 'a model attempting a final answer without any readable page',
    should: 'return the actual retrieval condition and no invented source claims',
    actual: outcomes,
    expected: [
      [false, true, [], undefined],
      [false, true, [], undefined],
      [false, true, [], undefined],
    ],
  })
})

test('Sunny can combine a notebook source and an authorized public page in one research run', async () => {
  await fixture({ 'notes/atlas.md': 'Atlas requires a public standard with optional caching.' }, async (base) => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        call('n', 'read_file', { path: 'notes/atlas.md' }),
        call('w', 'read_web_page', { url: 'https://example.com/standard' }),
        answer('The public standard supports the caching requirement recorded in the notebook.'),
      ],
    })
    const engine = createVoiceResearch(options(base), {
      model: () => ({ model }),
      fetcher: async () =>
        new Response('Optional caching is supported.', { headers: { 'content-type': 'text/plain' } }),
    })
    const result = await engine.research(
      'Compare the notebook requirements to the public documentation at https://example.com/standard',
    )
    assert({
      given: 'an explicitly requested comparison of private requirements with a public page',
      should: 'retain both notebook and web evidence without needing a public query containing private terms',
      actual: [result.paths, result.urls],
      expected: [['notes/atlas.md'], ['https://example.com/standard']],
    })
  })
})

test('voice web lookup requires a page read after a successful search before allowing an answer', async () => {
  const controls: unknown[] = []
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      if (step++ === 0) return call('s', 'web_search', { query: 'public standard version' })
      if (step === 2) {
        controls.push([input.toolChoice, input.tools?.map((entry) => entry.name)])
        if (input.toolChoice?.type === 'tool' && input.toolChoice.toolName === 'read_web_page')
          return call('r', 'read_web_page', { url: 'https://example.com/standard' })
        return answer('The search snippet is sufficient; I will skip the page.')
      }
      return answer('Example Standards confirms version two in its documentation.')
    },
  })
  const engine = createVoiceResearch(
    { ...options('/unused'), webApiKey: 'mock-api-key' },
    {
      model: () => ({ model }),
      fetcher: async (url) =>
        url.endsWith('/search')
          ? Response.json({
              results: [
                {
                  title: 'Example Standards',
                  url: 'https://example.com/standard',
                  snippet: 'Version two is available.',
                },
              ],
            })
          : new Response('The documented supported version is two.', { headers: { 'content-type': 'text/plain' } }),
    },
  )
  const result = await engine.lookupWeb('Check the public standard version on the web.')
  assert({
    given: 'a model that would otherwise stop after a nonempty search result',
    should: 'restrict the next step to a page read and return evidence from that actual page',
    actual: [controls, model.doGenerateCalls.length, result],
    expected: [
      [[{ type: 'tool', toolName: 'read_web_page' }, ['read_web_page']]],
      3,
      {
        status: 'complete',
        answer: 'Example Standards confirms version two in its documentation.',
        paths: [],
        urls: ['https://example.com/standard'],
      },
    ],
  })
})

test('voice web lookup requires another candidate after a blocked first page', async () => {
  const controls: unknown[] = []
  const reads: string[] = []
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      if (step++ === 0) return call('s', 'web_search', { query: 'public standard compatibility' })
      if (step <= 3) {
        controls.push([input.toolChoice, input.tools?.map((entry) => entry.name)])
        if (input.toolChoice?.type === 'tool' && input.toolChoice.toolName === 'read_web_page')
          return call(`r${step}`, 'read_web_page', {
            url: step === 2 ? 'https://example.com/blocked' : 'https://example.com/guide',
          })
        return answer('The first page failed, so please send another link.')
      }
      return answer('The public guide confirms compatibility with version two.')
    },
  })
  const engine = createVoiceResearch(
    { ...options('/unused'), webApiKey: 'mock-api-key' },
    {
      model: () => ({ model }),
      fetcher: async (url) => {
        if (url.endsWith('/search'))
          return Response.json({
            results: [
              { title: 'Blocked reference', url: 'https://example.com/blocked', snippet: 'Compatibility details.' },
              { title: 'Public guide', url: 'https://example.com/guide', snippet: 'Supported versions.' },
            ],
          })
        reads.push(url)
        return url.endsWith('/blocked')
          ? new Response('', { status: 403 })
          : new Response('Version two is compatible.', { headers: { 'content-type': 'text/plain' } })
      },
    },
  )
  const result = await engine.lookupWeb('Check public documentation for version compatibility.')
  assert({
    given: 'a blocked first result and another untried candidate',
    should: 'read the next candidate and retain only the successful source',
    actual: [controls, reads, model.doGenerateCalls.length, result],
    expected: [
      [
        [{ type: 'tool', toolName: 'read_web_page' }, ['read_web_page']],
        [{ type: 'tool', toolName: 'read_web_page' }, ['read_web_page']],
      ],
      ['https://example.com/blocked', 'https://example.com/guide'],
      4,
      {
        status: 'complete',
        answer: 'The public guide confirms compatibility with version two.',
        paths: [],
        urls: ['https://example.com/guide'],
      },
    ],
  })
})

test('voice web lookup does not require a nonexistent page after missing configuration or empty search', async () => {
  const outcomes: unknown[] = []
  for (const kind of ['missing', 'empty']) {
    let forcedRead = false
    let requests = 0
    let step = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (input) => {
        if (step++ === 0) return call('s', 'web_search', { query: 'public topic' })
        forcedRead = input.toolChoice?.type === 'tool' && input.toolChoice.toolName === 'read_web_page'
        return answer('The requested source could not be established.')
      },
    })
    const engine = createVoiceResearch(
      { ...options('/unused'), webApiKey: kind === 'missing' ? undefined : 'mock-api-key' },
      {
        model: () => ({ model }),
        fetcher: async () => {
          requests++
          return Response.json({ results: [] })
        },
      },
    )
    const result = await engine.lookupWeb('Search the web for this public topic.')
    outcomes.push([
      forcedRead,
      requests,
      result.answer.includes(kind === 'missing' ? 'PERPLEXITY_API_KEY' : 'no readable page evidence'),
      result.urls,
    ])
  }
  assert({
    given: 'no page URL from the question or the attempted search',
    should: 'preserve the real missing-key or empty-search condition without forcing an unavailable read',
    actual: outcomes,
    expected: [
      [false, 0, true, undefined],
      [false, 1, true, undefined],
    ],
  })
})

test('fast web lookup can read a specific source found through a followup search', async () => {
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      switch (step++) {
        case 0:
          return call('s', 'web_search', { query: 'example current standard' })
        case 1:
          return call('r', 'read_web_page', { url: 'https://example.com/index' })
        case 2:
          return call('s2', 'web_search', { query: 'example version three reference' })
        case 3:
          return input.toolChoice?.type === 'none'
            ? answer('I ran out of steps before reading the specific reference.')
            : call('r2', 'read_web_page', { url: 'https://example.com/reference' })
        default:
          return answer('The current reference confirms version three.')
      }
    },
  })
  const result = await createVoiceResearch(
    { ...options('/unused'), webApiKey: 'mock-api-key' },
    {
      model: () => ({ model }),
      fetcher: async (url, init) =>
        url.endsWith('/search')
          ? Response.json({
              results: [
                {
                  title: 'Public standard',
                  url: String(init?.body).includes('version three')
                    ? 'https://example.com/reference'
                    : 'https://example.com/index',
                  snippet: 'Read the reference to confirm the current version.',
                },
              ],
            })
          : new Response(
              url.endsWith('/reference')
                ? 'Version three is current.'
                : 'See the version three reference for current status.',
              { headers: { 'content-type': 'text/plain' } },
            ),
    },
  ).lookupWeb('What is the current version of the public standard?')
  assert({
    given: 'an index page that points to a more specific source',
    should: 'allow a second search and read before the answer without handing back an unfinished lookup',
    actual: [model.doGenerateCalls.length, result],
    expected: [
      5,
      {
        status: 'complete',
        answer: 'The current reference confirms version three.',
        paths: [],
        urls: ['https://example.com/index', 'https://example.com/reference'],
      },
    ],
  })
})

test('web lookup reserves its sixth step for speech and rejects raw tool markup as a final answer', async () => {
  let step = 0
  let finalControls: unknown
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      if (++step < 6) return call(`r${step}`, 'read_web_page', { url: 'https://example.com/reference' })
      finalControls = [input.toolChoice, input.tools, JSON.stringify(input.prompt).includes('Answer now')]
      return answer('<tool_call>\n<function=read_web_page>\n<parameter=url>https://example.com/reference</parameter>')
    },
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model }),
    pageFetcher: async () => new Response('Public reference.', { headers: { 'content-type': 'text/plain' } }),
  }).lookupWeb('Check https://example.com/reference')
  assert({
    given: 'a model that continues investigating and emits a textual tool request on its last step',
    should: 'stop within six steps and report unfinished synthesis instead of passing markup to Sky',
    actual: [
      step,
      finalControls,
      result.answer.includes('<tool_call>'),
      result.answer.includes('did not produce a final answer'),
      result.urls,
    ],
    expected: [6, [{ type: 'none' }, undefined, true], false, true, ['https://example.com/reference']],
  })
})

test('latest web questions receive today and instructions to verify historical announcements against maintained sources', async () => {
  const outcomes: unknown[] = []
  for (const method of ['lookupWeb', 'researchWeb'] as const) {
    let guidance: boolean[] = []
    let step = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (input) => {
        if (step++ === 0) {
          const system = input.prompt
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n')
          guidance = [
            system.includes(PlainDate.today().toString()),
            /catalog/i.test(system),
            /changelog/i.test(system),
            /(?:older|historical|old )/i.test(system) && /announcement/i.test(system),
            /(?:verify|check|confirm)/i.test(system) && /(?:latest|current|newest)/i.test(system),
          ]
          return call('s', 'web_search', { query: 'example standard latest version' })
        }
        return step === 2
          ? call('r', 'read_web_page', { url: 'https://example.com/catalog' })
          : answer('The maintained public catalog lists version three; the older announcement described version two.')
      },
    })
    const engine = createVoiceResearch(
      { ...options('/unused'), webApiKey: 'mock-api-key' },
      {
        model: () => ({ model }),
        fetcher: async (url) =>
          url.endsWith('/search')
            ? Response.json({
                results: [
                  {
                    title: 'Earlier release announcement',
                    url: 'https://example.com/announcement',
                    snippet: 'Announcing version two.',
                  },
                  {
                    title: 'Maintained version catalog',
                    url: 'https://example.com/catalog',
                    snippet: 'Version three is current.',
                  },
                ],
              })
            : new Response('The maintained catalog lists version three as current.', {
                headers: { 'content-type': 'text/plain' },
              }),
      },
    )
    const result = await engine[method]('Check the web for the latest version of the public standard.')
    outcomes.push([method, guidance, result.urls])
  }
  assert({
    given: 'a latest-version question with both historical and maintained sources',
    should:
      'supply the actual current date and freshness guidance in both research modes while retaining the read catalog',
    actual: outcomes,
    expected: [
      ['lookupWeb', [true, true, true, true, true], ['https://example.com/catalog']],
      ['researchWeb', [true, true, true, true, true], ['https://example.com/catalog']],
    ],
  })
})

test('Astra public research requires the custom search function without the native OpenAI tool alias', async () => {
  let request: { tool_choice?: unknown; tools?: { type: string; name?: string }[] } | undefined
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_input: unknown, init?: RequestInit) => {
      request = JSON.parse(String(init?.body))
      return Response.json({ error: { message: 'Synthetic stop after inspecting the request.' } }, { status: 400 })
    }) as typeof fetch,
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model: provider.responses('gpt-6-astra') }),
  }).researchWeb('Research the public example standard and compare its documented versions.')
  assert({
    given: 'the actual OpenAI provider serializing the first deep-web request',
    should: 'require the sole custom web_search function instead of referring to nonexistent web_search_preview',
    actual: [request?.tool_choice, request?.tools?.map(({ type, name }) => ({ type, name })), result.status],
    expected: ['required', [{ type: 'function', name: 'web_search' }], 'failed'],
  })
})

test('voice research preserves complete prose beyond the former character cutoff', async () => {
  const report = 'The public source supports version two. '.repeat(70) + 'That completes the comparison.'
  const model = new MockLanguageModelV3({
    doGenerate: [call('r', 'read_web_page', { url: 'https://example.com/standard' }), answer(report)],
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model }),
    pageFetcher: async () => new Response('Version two is supported.', { headers: { 'content-type': 'text/plain' } }),
  }).lookupWeb('Read https://example.com/standard')
  assert({
    given: 'a completed response that exceeds the former 1,800-character cutoff',
    should: 'retain its final sentence instead of inserting a spoken report-truncation notice',
    actual: [result.status, result.answer],
    expected: ['complete', report],
  })
})

test('Sunny recovers a grounded partial report when a later model step fails', async () => {
  let step = 0
  let synthesisEvidence = false
  let synthesisHasTools = true
  const model = new MockLanguageModelV3({
    doGenerate: async (input) => {
      switch (step++) {
        case 0:
          return call('r', 'read_web_page', { url: 'https://example.com/standard' })
        case 1:
          throw new Error('Synthetic model connection failure.')
        default:
          synthesisEvidence = JSON.stringify(input.prompt).includes('Version two adds optional caching.')
          synthesisHasTools = !!input.tools?.length
          return answer('Version two adds optional caching. I could not finish comparing the migration details.')
      }
    },
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model }),
    pageFetcher: async () =>
      new Response('Version two adds optional caching.', { headers: { 'content-type': 'text/plain' } }),
  }).researchWeb('Research https://example.com/standard and compare its migration details.')
  assert({
    given: 'a successful source read followed by a model connection failure',
    should: 'summarize retained evidence once without more retrieval and report a partial result',
    actual: [step, synthesisEvidence, synthesisHasTools, result.status, result.answer, result.urls],
    expected: [
      3,
      true,
      false,
      'partial',
      'Version two adds optional caching. I could not finish comparing the migration details.',
      ['https://example.com/standard'],
    ],
  })
})

test('Sunny distinguishes unfinished synthesis from failed retrieval when recovery also fails', async () => {
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      if (step++ === 0) return call('r', 'read_web_page', { url: 'https://example.com/standard' })
      throw new Error('Synthetic model unavailable.')
    },
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model }),
    pageFetcher: async () =>
      new Response('Version two adds optional caching.', { headers: { 'content-type': 'text/plain' } }),
  }).researchWeb('Research https://example.com/standard')
  assert({
    given: 'readable evidence followed by two failed synthesis attempts',
    should: 'retain the actual source and label unfinished synthesis as partial, not nonexistent web evidence',
    actual: [
      step,
      result.status,
      result.answer.includes('I read source material'),
      result.urls,
      result.reason,
      result.evidence,
    ],
    expected: [
      3,
      'partial',
      true,
      ['https://example.com/standard'],
      'Synthetic model unavailable.',
      [{ source: 'https://example.com/standard', text: 'Version two adds optional caching.', truncated: false }],
    ],
  })
})

test('Sunny retains bounded actual source excerpts when synthesis stays unavailable', async () => {
  const pages = Array.from({ length: 8 }, (_, i) => `https://example.com/source-${i}`)
  const bodies = new Map(pages.map((url, i) => [url, `Public evidence ${i}: ${'🧭\u0000'.repeat(1000)}`]))
  let step = 0
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      if (step < pages.length) return call(`r${step}`, 'read_web_page', { url: pages[step++] })
      throw new Error('Synthetic model unavailable.')
    },
  })
  const result = await createVoiceResearch(options('/unused'), {
    model: () => ({ model }),
    pageFetcher: async (url) => new Response(bodies.get(url), { headers: { 'content-type': 'text/plain' } }),
  }).researchWeb(`Compare the public evidence in ${pages.join(' ')}`)
  assert({
    given: 'eight read sources with multibyte and JSON-escaped characters, followed by unavailable synthesis',
    should: 'give Sunny real readable evidence from multiple sources within a combined serialized 24KB allowance',
    actual: [
      result.status,
      result.urls?.length,
      (result.evidence?.length ?? 0) > 1,
      Buffer.byteLength(JSON.stringify(result.evidence)) <= 24_000,
      result.evidence?.every(
        (entry) =>
          bodies.get(entry.source)?.startsWith(entry.text) &&
          entry.text.length > 0 &&
          !entry.text.includes('�') &&
          entry.truncated,
      ),
    ],
    expected: ['partial', 8, true, true, true],
  })
})
