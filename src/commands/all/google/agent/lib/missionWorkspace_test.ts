import { readFile } from 'node:fs/promises'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { isStepCount, streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { GoogleClient } from '#lib/google/client.ts'
import type { WorkspaceKind } from '#lib/google/drive.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { createMissionWorkspace, missionWorkspaces } from './missionWorkspace.ts'
import { createAgentTools, createMissionState } from './tools.ts'

const PROMPT_FILES = { doc: 'docs', slides: 'slides', sheet: 'sheets' }
const prompt = (name: string) => readFile(new URL(`../prompts/${name}.prompt.md`, import.meta.url), 'utf8')

async function workspace(initial: WorkspaceKind[], loadPrompt = (kind: WorkspaceKind) => prompt(PROMPT_FILES[kind])) {
  const client = new GoogleClient({
    secrets: new TestSecretsProvider(),
    email: 'jane@example.com',
    client: { clientId: 'mock-id', clientSecret: 'mock-secret' },
    fetchFn: (async (_input: RequestInfo | URL): Promise<Response> => {
      throw new Error('Workspace selection must not call Google')
    }) as typeof fetch,
  })
  const tools = createAgentTools({
    client,
    log: () => {},
    state: createMissionState(),
    missionModel: { model: 'test:workspace' },
    critiquePrompt: '',
    deckCritiquePrompt: '',
    docCritiquePrompt: '',
  })
  return createMissionWorkspace({ tools, initial, commonPrompt: await prompt('agent'), loadPrompt, log: () => {} })
}

function model(partsByStep: LanguageModelV3StreamPart[][] = []) {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const parts = partsByStep[step++] ?? [
        { type: 'text-start', id: 'report' },
        { type: 'text-delta', id: 'report', delta: 'Done.' },
        { type: 'text-end', id: 'report' },
      ]
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part)
            controller.enqueue({
              type: 'finish',
              finishReason: {
                unified: parts.some((part) => part.type === 'tool-call') ? 'tool-calls' : 'stop',
                raw: undefined,
              },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }
    },
  })
}

test('the opening request and real target select the initial workspaces', () => {
  assert({
    given: 'single-format, mixed-format, targeted, and ambiguous missions with format names in their source content',
    should: 'select requested formats without loading unrelated formats from the brief or guessing every workspace',
    actual: [
      missionWorkspaces('Create a presentation for Atlas. Content: docs and spreadsheets are part of its roadmap.'),
      missionWorkspaces('Create a presentation about documents and spreadsheets'),
      missionWorkspaces('Create a presentation titled Spreadsheet Migration'),
      missionWorkspaces('Create a presentation without a spreadsheet'),
      missionWorkspaces(
        'Create a Google Doc titled Atlas Plan.\nSlides and sheets are mentioned in the supplied prose.',
      ),
      missionWorkspaces('Create a spreadsheet tracker for Atlas'),
      missionWorkspaces('Create a presentation and spreadsheet from this document'),
      missionWorkspaces('Fix the totals', 'sheet'),
      missionWorkspaces('Create a presentation from this file', 'doc'),
      missionWorkspaces('Turn this document into a presentation', 'doc'),
      missionWorkspaces('Help organize Atlas'),
    ],
    expected: [
      ['slides'],
      ['slides'],
      ['slides'],
      ['slides'],
      ['doc'],
      ['sheet'],
      ['slides', 'sheet'],
      ['sheet'],
      ['slides'],
      ['slides'],
      [],
    ],
  })
})

for (const kind of ['doc', 'slides', 'sheet'] as const) {
  test(`${kind} missions send only their workspace tools and instructions to the model`, async () => {
    const selected = await workspace([kind])
    const fake = model()
    const stream = streamText({
      model: fake,
      instructions: selected.instructions(),
      messages: [{ role: 'user', content: 'Complete the Atlas mission.' }],
      tools: selected.tools,
      activeTools: selected.activeTools(),
      prepareStep: selected.prepareStep,
    })
    await stream.text
    const sent = fake.doStreamCalls[0]!
    const names = new Set(sent.tools?.map((tool) => tool.name))
    const instructions = sent.prompt
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n')
    assert({
      given: `a ${kind}-only mission at the actual streaming model boundary`,
      should: 'omit other formats from tool definitions and prompt content while keeping shared Drive capabilities',
      actual: {
        doc: names.has('create_doc'),
        suggestions: names.has('suggest_doc_edit'),
        slides: names.has('create_presentation'),
        sheet: names.has('create_spreadsheet'),
        shared: names.has('find_files') && names.has('read_file') && names.has('load_workspace_tools'),
        docInstructions: instructions.includes('## Styling Docs with batch_update_doc'),
        slideInstructions: instructions.includes('## Building Slides'),
        sheetInstructions: instructions.includes('## Building Spreadsheets'),
        slideTokens: instructions.includes('# Design Tokens (mandatory)'),
      },
      expected: {
        doc: kind === 'doc',
        suggestions: kind === 'doc',
        slides: kind === 'slides',
        sheet: kind === 'sheet',
        shared: true,
        docInstructions: kind === 'doc',
        slideInstructions: kind === 'slides',
        sheetInstructions: kind === 'sheet',
        slideTokens: kind === 'slides',
      },
    })
  })
}

test('loading another workspace adds its tools and prompt on the next model step', async () => {
  const reads: WorkspaceKind[] = []
  const selected = await workspace(['slides'], async (kind) => {
    reads.push(kind)
    return prompt(PROMPT_FILES[kind])
  })
  const fake = model([
    [{ type: 'tool-call', toolCallId: 'load-sheet', toolName: 'load_workspace_tools', input: '{"formats":["sheet"]}' }],
  ])
  const stream = streamText({
    model: fake,
    instructions: selected.instructions(),
    messages: [{ role: 'user', content: 'Create a native chart in the Atlas presentation.' }],
    tools: selected.tools,
    activeTools: selected.activeTools(),
    prepareStep: selected.prepareStep,
    stopWhen: isStepCount(3),
  })
  await stream.text
  const calls = fake.doStreamCalls
  const names = calls.map((call) => new Set(call.tools?.map((tool) => tool.name)))
  const instructions = calls.map((call) =>
    call.prompt.filter((message) => message.role === 'system').map((message) => message.content),
  )
  const again = await selected.tools.load_workspace_tools.execute({ formats: ['sheet'] })
  assert({
    given: 'a Slides mission discovers it needs a sheet-backed chart',
    should: 'add Sheets once on the next step, retain the previous prompt prefix and history, and keep Docs unloaded',
    actual: {
      calls: calls.length,
      reads,
      sheets: names.map((tools) => tools.has('set_values')),
      docs: names.map((tools) => tools.has('create_doc')),
      samePrefix: instructions[1]?.[0] === instructions[0]?.[0] && instructions[1]?.[1] === instructions[0]?.[1],
      history: calls[1]?.prompt.some((message) => message.role === 'tool'),
      again,
    },
    expected: {
      calls: 2,
      reads: ['slides', 'sheet'],
      sheets: [false, true],
      docs: [false, false],
      samePrefix: true,
      history: true,
      again: { enabled: ['slides', 'sheet'], added: [] },
    },
  })
})

test('ambiguous missions begin with shared tools and can choose a workspace', async () => {
  const reads: WorkspaceKind[] = []
  const selected = await workspace([], async (kind) => {
    reads.push(kind)
    return 'Customized Atlas workspace instructions.'
  })
  const before = selected.activeTools()
  await selected.tools.load_workspace_tools.execute({ formats: ['doc'] })
  assert({
    given: 'a request whose format cannot be inferred locally',
    should: 'let the mission choose through one small loader without preloading every prompt or tool',
    actual: [
      before.includes('create_doc'),
      before.includes('create_presentation'),
      before.includes('create_spreadsheet'),
      reads,
      selected.activeTools().includes('create_doc'),
      selected.instructions().some((message) => message.content === 'Customized Atlas workspace instructions.'),
    ],
    expected: [false, false, false, ['doc'], true, true],
  })
})

test('a model cannot execute an unloaded workspace tool by guessing its name', async () => {
  const selected = await workspace(['slides'])
  const result = await selected.tools.create_doc.execute({ title: 'Atlas Plan', markdown: '# Atlas' })
  assert({
    given: 'a Slides-only mission calls a Docs tool that was absent from its payload',
    should: 'require an explicit workspace load before any Google request or mutation',
    actual: [String(result).includes('call load_workspace_tools'), selected.activeTools().includes('create_doc')],
    expected: [true, false],
  })
})

test('mixed-format missions keep prompt caching within provider limits', async () => {
  const selected = await workspace(['doc', 'slides', 'sheet'])
  const prepared = selected.prepareStep({ messages: [{ role: 'user', content: 'Complete the Atlas mission.' }] })
  const cacheBreakpoints = [...prepared.instructions, ...prepared.messages].filter(
    (message) => message.providerOptions?.['anthropic']?.['cacheControl'],
  ).length
  assert({
    given: 'a mission requiring every Workspace format on a provider with four cache breakpoints',
    should: 'keep all requested tools and the history breakpoint without exceeding the cache limit',
    actual: [
      prepared.activeTools.includes('create_doc'),
      prepared.activeTools.includes('create_presentation'),
      prepared.activeTools.includes('create_spreadsheet'),
      cacheBreakpoints <= 4,
      !!prepared.messages.at(-1)?.providerOptions?.['anthropic']?.['cacheControl'],
    ],
    expected: [true, true, true, true, true],
  })
})

test('a failed prompt load leaves all newly requested workspaces disabled', async () => {
  const selected = await workspace(['slides'], async (kind) => {
    if (kind === 'sheet') throw new Error('Synthetic prompt read failed')
    return prompt(PROMPT_FILES[kind])
  })
  const before = selected.activeTools()
  const result = await selected.tools.load_workspace_tools.execute({ formats: ['doc', 'sheet'] })
  assert({
    given: 'one prompt in a mixed-format load fails',
    should: 'explain the failure and preserve the previously enabled Slides tools without partially enabling Docs',
    actual: [String(result).includes('No new formats were enabled'), selected.activeTools()],
    expected: [true, before],
  })
})
