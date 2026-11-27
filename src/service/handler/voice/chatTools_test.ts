import { tool } from 'ai'
import { z } from 'zod'
import { assert, test } from '#test'
import { liveToolOutput, pageReadOutput, VOICE_READ_CHARS, voiceChatTools } from './chatTools.ts'

test('voice preserves native PDF and image content instead of sending file metadata alone', () => {
  assert({
    given: 'the shared read_file model output',
    should: 'forward every text and native document part to the managed Responses backend',
    actual: liveToolOutput({
      type: 'content',
      value: [
        { type: 'text', text: 'Atlas report' },
        { type: 'file', filename: 'Atlas.pdf', mediaType: 'application/pdf', data: { type: 'data', data: 'cGRm' } },
        { type: 'file', filename: 'Atlas.png', mediaType: 'image/png', data: { type: 'data', data: 'aW1hZ2U=' } },
      ],
    }),
    expected: [
      { type: 'input_text', text: 'Atlas report' },
      { type: 'input_file', filename: 'Atlas.pdf', file_data: 'data:application/pdf;base64,cGRm' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,aW1hZ2U=' },
    ],
  })
})

test('voice validates shared tool schemas and forwards cancellation to every executor', async () => {
  let executions = 0
  let seenSignal: AbortSignal | undefined
  const lifetime = new AbortController()
  const events: string[] = []
  const shared = {
    newly_added_chat_tool: tool({
      description: 'A tool added to chat is available in voice.',
      inputSchema: z.object({ count: z.number().int().positive() }),
      execute: async ({ count }: { count: number }, { abortSignal }: { abortSignal?: AbortSignal }) => {
        executions++
        seenSignal = abortSignal
        return { count }
      },
    }),
  }
  const { tools } = await voiceChatTools(
    {
      build: async () => ({ tools: shared, toolApproval: {}, systemInstructions: 'Shared instructions.' }),
      record: (event) => events.push(event.type),
      persist: async () => {},
      close: async () => {},
    },
    [],
    lifetime.signal,
  )
  let invalid = ''
  try {
    await tools.get('newly_added_chat_tool')!.run({ count: -1 })
  } catch (error) {
    invalid = String(error)
  }
  await tools.get('newly_added_chat_tool')!.run({ count: 2 }, undefined, 'delegation', 'call')
  lifetime.abort()
  let stopped = false
  try {
    await tools.get('newly_added_chat_tool')!.run({ count: 3 })
  } catch {
    stopped = true
  }
  assert({
    given: 'a newly registered tool, invalid input, and a stopped call',
    should: 'share the tool automatically, reject invalid input, and honor cancellation',
    actual: [
      [...tools.keys()],
      invalid.includes('Invalid newly_added_chat_tool arguments'),
      executions,
      seenSignal?.aborted,
      stopped,
      events,
    ],
    expected: [['newly_added_chat_tool'], true, 1, true, true, ['tool-execution-start', 'tool-execution-end']],
  })
})

test('a spoken session starts with the data a typed message would have carried', async () => {
  const drafts = 'Current drafts: [{"draftId":"atlas-note","draftRevision":2}]'
  const { instructions } = await voiceChatTools(
    {
      build: async () => ({
        tools: {},
        toolApproval: {},
        systemInstructions: 'Shared instructions.',
        instructions: 'How to work with drafts.',
        referenceData: drafts,
      }),
      record: () => {},
      persist: async () => {},
      close: async () => {},
    },
    [],
    new AbortController().signal,
  )
  assert({
    given: 'a chat whose host has standing instructions and data that changes',
    should: 'give voice all three, the changing data last: it has no later message to carry it',
    actual: instructions,
    expected: `Shared instructions.\n\nHow to work with drafts.\n\n${drafts}`,
  })
})

test('a voice read is one page: find opens the passage, and the header says where the page sits', () => {
  const header = 'File: /notebook/time/2026/W11/03-11/atlas-transcript.txt\nType: text, 30,000 characters'
  const body = `${'Small talk about the weather. '.repeat(500)}Jane Doe: we ship the Atlas plan on Friday. ${'More notes. '.repeat(1200)}`
  const whole = [{ type: 'input_text' as const, text: `${header}\n\n${body}` }]
  const first = pageReadOutput(whole, {}) as Array<{ text: string }>
  const found = pageReadOutput(whole, { find: 'ship the atlas plan' }) as Array<{ text: string }>
  const missing = pageReadOutput(whole, { find: 'Widget-V2' }) as Array<{ text: string }>
  const pdf = [
    { type: 'input_text' as const, text: 'File: /notebook/atlas.pdf' },
    { type: 'input_file' as const, file_data: 'cGRm' },
  ]
  assert({
    given: 'a 30,000-character transcript read whole, read with find, read for missing text, and a PDF',
    should:
      'return one page with a continuation offset, open near the passage, report the miss, and pass the PDF through',
    actual: {
      firstSize: first[0]!.text.length <= header.length + VOICE_READ_CHARS + 200,
      continues: first[0]!.text.includes(`Continue with read_file offset ${VOICE_READ_CHARS}`),
      foundPassage: found[0]!.text.includes('Jane Doe: we ship the Atlas plan on Friday.'),
      foundStartsBeforeIt: found[0]!.text.includes('Showing characters 14,013 to 22,013'),
      missing: missing[0]!.text.includes(
        `The text "Widget-V2" was not found at or after character 0 of ${body.length.toLocaleString('en-US')}.\nShowing characters 0 to 8,000`,
      ),
      pdf: pageReadOutput(pdf, { find: 'Atlas' }),
    },
    expected: { firstSize: true, continues: true, foundPassage: true, foundStartsBeforeIt: true, missing: true, pdf },
  })
})

test('voice pages read_file and runs research in the background, leaving other tools as chat defines them', async () => {
  const shared = {
    read_file: tool({
      description: 'Read a file.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => ({ path }),
      toModelOutput: () => ({ type: 'content', value: [{ type: 'text', text: `File: x\n\n${'a'.repeat(20_000)}` }] }),
    }),
    ai_research: tool({
      description: 'Research the notebook.',
      inputSchema: z.object({ question: z.string() }),
      execute: async () => ({ digest: 'Atlas ships Friday.' }),
    }),
  }
  const { tools } = await voiceChatTools(
    {
      build: async () => ({ tools: shared, toolApproval: {}, systemInstructions: '' }),
      record: () => {},
      persist: async () => {},
      close: async () => {},
    },
    [],
    new AbortController().signal,
  )
  const read = tools.get('read_file')!
  const output = (await read.run({ path: '/notebook/x.md', find: 'aaa', offset: 0 })) as Array<{ text: string }>
  const properties = Object.keys((read.definition.parameters as { properties: object }).properties)
  assert({
    given: 'chat’s read_file and ai_research',
    should:
      'add find and offset to the read, strip them before chat’s schema sees them, and flag research as background',
    actual: {
      properties,
      paged: output[0]!.text.length < 20_000,
      researchBackground: tools.get('ai_research')!.background,
      readBackground: read.background,
    },
    expected: {
      properties: ['path', 'find', 'offset'],
      paged: true,
      researchBackground: true,
      readBackground: undefined,
    },
  })
})

test('a short file comes back whole whatever find says, and a long file fills its page near the end', () => {
  const header = 'File: /notebook/time/2026/W11/03-11/atlas.md\nType: text, 4,000 characters'
  const short = `---\ntitle: Atlas review\nwho: Jane Doe\n---\n${'Notes. '.repeat(400)}Decision: ship Friday.`
  const long = `${'Background. '.repeat(2500)}Decision: ship Friday. Thanks all.`
  const read = (body: string, request: { offset?: number; find?: string }, fullText?: string) =>
    (
      pageReadOutput([{ type: 'input_text', text: `${header}\n\n${body}` }], request, fullText) as Array<{
        text: string
      }>
    )[0]!.text
  const hit = read(short, { find: 'decision' })
  const miss = read(short, { find: 'Widget-V2' })
  const end = read(long, { find: 'Thanks all' })
  const cutHeader = 'File: /notebook/transcript.txt\nType: text, cut to the first 200,000 characters of 240,023'
  const whole = `${'Talk. '.repeat(40_000)}Widget-V2 decision: go.`
  const cut = (
    pageReadOutput(
      [{ type: 'input_text', text: `${cutHeader}\n\n${whole.slice(0, 200_000)}` }],
      { find: 'Widget-V2 decision' },
      whole,
    ) as Array<{
      text: string
    }>
  )[0]!.text
  assert({
    given:
      'a 2,800-character file read with a matching and a missing find, a 30,000-character file found at its end, and a cut transcript',
    should: 'return the short file whole (saying when find missed), fill the last page, and page the whole transcript',
    actual: {
      hitWhole: hit.endsWith(short) && hit.includes('title: Atlas review'),
      missSays:
        miss.includes('The text "Widget-V2" does not appear in this file; the whole file follows.') &&
        miss.endsWith(short),
      endFilled: end.includes(
        `Showing characters ${(long.length - 8000).toLocaleString('en-US')} to ${long.length.toLocaleString('en-US')}`,
      ),
      endHasMatch: end.endsWith('Thanks all.'),
      cutFound: cut.includes('Widget-V2 decision: go.'),
      cutHeader: cut.includes('Type: text, 240,023 characters') && !cut.includes('cut to the first'),
    },
    expected: { hitWhole: true, missSays: true, endFilled: true, endHasMatch: true, cutFound: true, cutHeader: true },
  })
})

test('a page filled to the end of a file starts on a whole character, so it still reaches the end', () => {
  const header = 'File: /notebook/atlas.md\nType: text, 9,000 characters'
  // An emoji's second half sits exactly where an 8,000-character page counting back from the end would start.
  const tail = `${'x'.repeat(VOICE_READ_CHARS - 22)}Decision: ship Atlas.`
  const body = `${'Notes. '.repeat(200)}😀${tail}`
  const text = (
    pageReadOutput([{ type: 'input_text', text: `${header}\n\n${body}` }], { find: 'ship Atlas' }) as Array<{
      text: string
    }>
  )[0]!.text
  assert({
    given: 'a find near the end of a file whose fill start lands inside an emoji',
    should: 'return a page that ends at the end of the file, with no offer to read on',
    actual: { endsAtEnd: text.endsWith('Decision: ship Atlas.'), readsOn: text.includes('Continue with read_file') },
    expected: { endsAtEnd: true, readsOn: false },
  })
})
