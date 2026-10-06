import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { browserTaskHost } from '../task/host.ts'
import type { McpToolDefinition, McpToolResult } from './client.ts'
import { BROWSER_TOOL_NAMES, browserToolsFrom, claimDownloads, splitResult, toModelContent } from './tools.ts'

const definitions: McpToolDefinition[] = [
  { name: 'browser_snapshot', description: 'Look', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_run_code_unsafe', description: 'Run code', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_close', description: 'Close', inputSchema: { type: 'object', properties: {} } },
]

test('only the allowed server tools reach the model', () => {
  const calls: string[] = []
  const tools = browserToolsFrom(
    { callTool: async (name) => (calls.push(name), { content: [{ type: 'text', text: 'ok' }], isError: false }) },
    definitions,
  )
  assert({
    given: 'a server offering code execution and close beside snapshot',
    should: 'expose snapshot only',
    actual: Object.keys(tools),
    expected: ['browser_snapshot'],
  })
  assert({
    given: 'the allow list',
    should: 'never name the unsafe or host-control tools',
    actual: BROWSER_TOOL_NAMES.filter((n) =>
      ['browser_run_code_unsafe', 'browser_evaluate', 'browser_close'].includes(n),
    ),
    expected: [],
  })
})

test('a failed private sign-in reports to the chat host and stops subsequent browser moves', async () => {
  const messages: string[] = []
  const calls: string[] = []
  let paused = false
  const tools = browserToolsFrom(
    {
      callTool: async (name) => {
        calls.push(name)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'unavailable',
                reason: 'provider_unavailable',
                origin: 'https://atlas.example',
                message: 'mock-secret-provider-error',
              }),
            },
          ],
          isError: false,
        }
      },
    },
    [{ name: 'sign_in', inputSchema: { type: 'object', properties: {} } }, ...definitions],
    {
      allow: ['sign_in', 'browser_snapshot'],
      onSignInFailure: (message) => messages.push(message),
    },
  )
  const execute = (name: string) =>
    (tools[name] as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute(
      {},
      { toolCallId: name, messages: [] },
    )
  await browserTaskHost.run(
    {
      needsYou: async () => {
        throw new Error('A failed sign-in must not wait for the person')
      },
      nativeSignIn: async (run) => run(),
      signInFailed: async (message) => {
        messages.push(message)
        paused = true
      },
    },
    async () => {
      await execute('sign_in')
      await execute('browser_snapshot')
    },
  )
  assert({
    given: '1Password failed and returned an untrusted native message',
    should: 'pause the host, end further moves, and show only the fixed explanation and site',
    actual: [
      paused,
      calls,
      messages.length,
      messages.every((m) => m.includes('https://atlas.example')),
      JSON.stringify(messages).includes('mock-secret'),
    ],
    expected: [true, ['sign_in'], 2, true, false],
  })
})

test('a result splits into small logged output and the model-facing content', () => {
  const withImage: McpToolResult = {
    content: [
      { type: 'text', text: 'Page: Sign in' },
      { type: 'image', data: 'aGk=', mimeType: 'image/png' },
    ],
    isError: false,
  }
  const split = splitResult(withImage)
  assert({
    given: 'text and an image',
    should: 'keep the text and count the image in the raw output',
    actual: split.output,
    expected: { ok: true, text: 'Page: Sign in', images: 1 },
  })
  const content = toModelContent(split.output, split.images)
  assert({
    given: 'the same result for the model',
    should: 'attach the image as a file part after the text',
    actual:
      content.type === 'content'
        ? content.value.map((part) => (part.type === 'file' ? `${part.type}:${part.mediaType}` : part.type))
        : content.type,
    expected: ['text', 'file:image/png'],
  })
  const failed = toModelContent({ ok: false, text: 'Element not found', images: 0 }, [])
  assert({
    given: 'a failed action without images',
    should: 'reach the model as an error',
    actual: failed,
    expected: { type: 'error-text', value: 'Element not found' },
  })
  const plain = toModelContent({ ok: true, text: 'Navigated', images: 0 }, [])
  assert({
    given: 'a plain success',
    should: 'reach the model as text',
    actual: plain,
    expected: { type: 'text', value: 'Navigated' },
  })
})

test("an output the engine wrote itself passes through in the engine's shape", async () => {
  const tools = browserToolsFrom(
    { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }) },
    definitions,
  )
  const snapshot = tools.browser_snapshot as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => unknown
  }
  const refused = 'Error: refused — this exact browser_snapshot call already ran twice.'
  assert({
    given: 'a repetition-guard refusal, a plain string, in place of the tool output',
    should: 'reach the model as that text rather than an empty error',
    actual: snapshot.toModelOutput({ toolCallId: 'c9', input: {}, output: refused }),
    expected: { type: 'text', value: refused },
  })
  const stopped = { stopped: true }
  assert({
    given: 'any other engine-written object',
    should: 'pass through as json',
    actual: snapshot.toModelOutput({ toolCallId: 'c10', input: {}, output: stopped }),
    expected: { type: 'json', value: stopped },
  })
})

test('a tool call that throws becomes a failed output, not a crashed turn', async () => {
  const tools = browserToolsFrom(
    {
      callTool: async () => {
        throw new Error('The browser server stopped')
      },
    },
    definitions,
  )
  const snapshot = tools.browser_snapshot as { execute: (input: unknown, ctx: unknown) => Promise<unknown> }
  const output = await snapshot.execute({}, { toolCallId: 'c1', messages: [] })
  assert({
    given: 'a client that throws',
    should: 'return ok false with the message',
    actual: output,
    expected: { ok: false, text: 'The browser server stopped', images: 0 },
  })
})

test("a download in the driver's shared folder is moved into the task's own, and the result says where", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-claim-test-'))
  const from = path.join(root, 'downloads')
  const to = path.join(root, 'task-files')
  await mkdir(from)
  await mkdir(to)
  await writeFile(path.join(from, 'Atlas-2025.pdf'), '%PDF')
  await writeFile(path.join(to, 'Atlas-2024.pdf'), '%PDF older')
  await writeFile(path.join(from, 'Atlas-2024.pdf'), '%PDF newer')
  try {
    const text =
      '### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"\n- Downloaded file Atlas-2024.pdf to "./Atlas-2024.pdf"\n- Downloaded file Ghost.pdf to "./Ghost.pdf"'
    const claimed = await claimDownloads(text, { from, to })
    assert({
      given: 'two downloads present, one of them a name already taken in the task folder, and one that never landed',
      should: 'move both into the task folder without overwriting, rewrite their lines, and leave the ghost line alone',
      actual: {
        moved: claimed.moved.map((f) => path.basename(f)),
        left: await readdir(from),
        kept: (await readdir(to)).sort(),
        lines: claimed.text
          .split('\n')
          .slice(1)
          .map((l) => l.replace(root, '<root>')),
      },
      expected: {
        moved: ['Atlas-2025.pdf', 'Atlas-2024 (2).pdf'],
        left: [],
        kept: ['Atlas-2024 (2).pdf', 'Atlas-2024.pdf', 'Atlas-2025.pdf'],
        lines: [
          '- Downloaded file Atlas-2025.pdf to "<root>/task-files/Atlas-2025.pdf"',
          '- Downloaded file Atlas-2024 (2).pdf to "<root>/task-files/Atlas-2024 (2).pdf"',
          '- Downloaded file Ghost.pdf to "./Ghost.pdf"',
        ],
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
