/**
 * The tool-boundary contract: whatever runToolCommand returns is embedded
 * raw into the next SDK step's message array and zod-validated as JSON
 * there — far from the tool that produced it. The oracle here is the AI
 * SDK's OWN message schema (the validator that rejects bad payloads in
 * production), so these tests fail if either our shaping or the SDK's
 * tolerance changes.
 */

import { toolModelMessageSchema } from 'ai'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import { assert, test } from '#test'
import { extractExternalFiles, runToolCommand } from './notebookTools.ts'

/**
 * Stand-in for a rich SDK error (APICallError): a class instance whose
 * enumerable payload mirrors the megabytes a failed API call carries.
 */
class FakeApiError extends Error {
  requestBodyValues: unknown
  statusCode = 400
  constructor(message: string, requestBodyValues: unknown) {
    super(message)
    this.requestBodyValues = requestBodyValues
  }
}

const ENTRY = { toolName: 'fake_tool', commandName: 'fake:tool' }

const stubTasks = (result: CommandResult<unknown>) =>
  ({ run: () => Promise.resolve(result) }) as unknown as CommandService

/** Embed a tool output exactly as the SDK embeds it before validating. */
function asToolMessage(output: unknown) {
  return {
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: 'tc1', toolName: ENTRY.toolName, output: { type: 'json', value: output } },
    ],
  }
}

test('chat task tools attach trusted provenance without replacing the model context', async () => {
  const calls: Record<string, unknown>[] = []
  const tasks = {
    run: (_name: string, input: Record<string, unknown>) => {
      calls.push(input)
      return Promise.resolve(CommandResult.success())
    },
  } as unknown as CommandService
  const entry = { toolName: 'day_items_add', commandName: 'day:items:add' }
  const input = { task: 'Review the Atlas launch', notes: 'The release needs an owner and a go/no-go decision.' }
  await Promise.all([
    runToolCommand(tasks, entry, input, { sourceChat: '/chat/source/atlas' }),
    runToolCommand(tasks, entry, { task: 'Book the room', notes: '  ' }, { sourceChat: '/chat/source/offsite' }),
    runToolCommand(tasks, ENTRY, input, { sourceChat: '/chat/source/unrelated' }),
  ])
  assert({
    given: 'two chats creating tasks at once, plus an unrelated tool',
    should: 'attach each source to its own task, retain context, and leave other inputs untouched',
    actual: { calls, input },
    expected: {
      calls: [
        { ...input, notes: `${input.notes}\n\n[Source chat](/chat/source/atlas)` },
        { task: 'Book the room', notes: '[Source chat](/chat/source/offsite)' },
        input,
      ],
      input,
    },
  })
})

test('runToolCommand failure shaping', async () => {
  const cause = new FakeApiError('prompt is too long: 111 tokens > 100 maximum', { body: 'x'.repeat(4096) })
  const labeled = await runToolCommand(stubTasks(CommandResult.error(cause, 'Drafting failed')), ENTRY, {})

  assert({
    given: 'a CommandResult.error carrying a rich Error instance and a label',
    should: 'return label and cause concatenated as a plain string, never the Error',
    actual: labeled,
    expected: {
      success: false,
      status: 'error',
      error: 'Drafting failed: prompt is too long: 111 tokens > 100 maximum',
    },
  })

  const unlabeled = await runToolCommand(stubTasks(CommandResult.error(new Error('boom'))), ENTRY, {})
  assert({
    given: 'CommandResult.error with no label (message defaults to the cause message)',
    should: 'not repeat the message',
    actual: unlabeled.error,
    expected: 'boom',
  })

  const enormous = await runToolCommand(stubTasks(CommandResult.error(new Error('x'.repeat(500_000)))), ENTRY, {})
  assert({
    given: 'a failure whose message is itself enormous',
    should: 'clamp the model-facing string',
    actual: (enormous.error as string).length <= 2000,
    expected: true,
  })

  const failed = await runToolCommand(stubTasks(CommandResult.fail('a streak needs a cadence')), ENTRY, {})
  assert({
    given: 'a business-rule fail',
    should: 'keep its status and message',
    actual: failed,
    expected: { success: false, status: 'fail', error: 'a streak needs a cadence' },
  })
})

test('legal review prevents concurrent attempts and keeps blocked failure messages bounded', async () => {
  let finish!: (result: CommandResult<unknown>) => void
  const pending = new Promise<CommandResult<unknown>>((resolve) => {
    finish = resolve
  })
  let calls = 0
  const tasks = {
    run: () => {
      calls++
      return pending
    },
  } as unknown as CommandService
  const entry = { toolName: 'legal_review', commandName: 'legal:review' }
  const options = {
    legalReviewContext: {
      id: () => undefined,
      link: async () => {},
      sources: () => [],
      context: { source: 'chat:mock-review', instructions: '', conversation: [] },
    },
  }
  const first = runToolCommand(tasks, entry, {}, options)
  const concurrent = await runToolCommand(tasks, entry, { action: 'review' }, options)
  finish(CommandResult.fail('x'.repeat(8000)))
  await first
  const repeated = await runToolCommand(tasks, entry, { focus: 'Different wording' }, options)
  assert({
    given: 'concurrent analysis and a repeat after a large failure',
    should: 'invoke the command only once and return bounded schema-valid failures',
    actual: {
      calls,
      running: String(concurrent.error).includes('already running'),
      failed: String(repeated.error).includes('already failed'),
      bounded: String(repeated.error).length <= 2000,
      valid: toolModelMessageSchema.safeParse(asToolMessage(repeated)).success,
    },
    expected: { calls: 1, running: true, failed: true, bounded: true, valid: true },
  })
})

test('runToolCommand outputs satisfy the SDK message schema', async () => {
  const cause = new FakeApiError('prompt is too long: 111 tokens > 100 maximum', { body: 'x'.repeat(4096) })
  const shaped = await runToolCommand(stubTasks(CommandResult.error(cause, 'Drafting failed')), ENTRY, {})
  assert({
    given: 'a shaped failure embedded as the SDK embeds tool outputs',
    should: "pass the SDK's own message schema",
    actual: toolModelMessageSchema.safeParse(asToolMessage(shaped)).success,
    expected: true,
  })

  // The control that keeps this suite honest: the pre-fix shape must FAIL
  // the schema. If this ever passes, the SDK has started accepting class
  // instances and this boundary no longer guards anything real.
  const legacy = { success: false, error: cause }
  assert({
    given: 'the old wrapper shape carrying the raw Error instance',
    should: "fail the SDK's message schema — the turn-killing incident shape",
    actual: toolModelMessageSchema.safeParse(asToolMessage(legacy)).success,
    expected: false,
  })
})

test('runToolCommand flattens success payloads to plain JSON', async () => {
  class Artifact {
    url: string
    constructor(url: string) {
      this.url = url
    }
  }
  const data = {
    title: 'Atlas',
    artifact: undefined,
    doc: new Artifact('https://example.com/d1'),
  }
  const out = await runToolCommand(stubTasks(CommandResult.success(data)), ENTRY, {})

  assert({
    given: 'a command returning a class instance and an undefined-valued key',
    should: 'flatten to schema-valid plain JSON, dropping the undefined key',
    actual: {
      keys: Object.keys(out).sort(),
      doc: out.doc,
      schemaAccepts: toolModelMessageSchema.safeParse(asToolMessage(out)).success,
    },
    expected: {
      keys: ['doc', 'success', 'title'],
      doc: { url: 'https://example.com/d1' },
      schemaAccepts: true,
    },
  })
})

test('runToolCommand threads the open-question breakout', async () => {
  const data = { openQuestions: [{ question: 'Cadence?', proposed: 'daily' }] }
  const out = await runToolCommand(
    stubTasks(CommandResult.success(data)),
    ENTRY,
    {},
    {
      onOpenQuestions: () => Promise.resolve([{ question: 'Cadence?', answer: 'weekdays' }]),
    },
  )

  assert({
    given: 'a tool returning openQuestions and a breakout handler answering them',
    should: 'ship the answers and clear the questions in the flattened output',
    actual: { answers: out.answers, openQuestions: out.openQuestions },
    expected: { answers: [{ question: 'Cadence?', answer: 'weekdays' }], openQuestions: [] },
  })
})

test('runToolCommand reports external files to the host', async () => {
  const data = {
    report: 'done',
    files: [
      { id: 'f1', title: 'Atlas Revenue Model', url: 'https://docs.google.com/spreadsheets/d/f1', action: 'read' },
      { id: 'f2', title: 'No URL yet', action: 'created' },
      'not-an-object',
    ],
  }
  const seen: Array<{ toolName: string; files: unknown }> = []
  await runToolCommand(
    stubTasks(CommandResult.success(data)),
    ENTRY,
    {},
    {
      onExternalFiles: (toolName, files) => seen.push({ toolName, files }),
    },
  )

  assert({
    given: 'a tool result whose files mix URL-bearing, URL-less, and malformed entries',
    should: 'deliver only well-formed entries, id and action riding along, labeled with the tool name',
    actual: seen,
    expected: [
      {
        toolName: 'fake_tool',
        files: [
          { title: 'Atlas Revenue Model', url: 'https://docs.google.com/spreadsheets/d/f1', id: 'f1', action: 'read' },
        ],
      },
    ],
  })

  const silent: unknown[] = []
  await runToolCommand(
    stubTasks(CommandResult.success({ report: 'no files here' })),
    ENTRY,
    {},
    {
      onExternalFiles: (_t, files) => silent.push(files),
    },
  )
  assert({
    given: 'a tool result without a files array',
    should: 'not invoke the handler at all',
    expected: 0,
    actual: silent.length,
  })
})

test('extractExternalFiles - lifts id and action when a tool reports them', () => {
  const files = extractExternalFiles({
    files: [
      { title: 'Atlas Plan', url: 'https://docs.google.com/document/d/f1/edit', id: 'f1', action: 'created' },
      { title: 'Atlas Notes', url: 'https://docs.google.com/document/d/f2/edit' },
      { title: '', url: 'https://docs.google.com/document/d/f3/edit', id: 'f3' },
    ],
  })

  assert({
    given: 'tool files with and without id/action, plus one with no title',
    should: 'lift the optional fields and keep the title/url contract',
    actual: files,
    expected: [
      { title: 'Atlas Plan', url: 'https://docs.google.com/document/d/f1/edit', id: 'f1', action: 'created' },
      { title: 'Atlas Notes', url: 'https://docs.google.com/document/d/f2/edit' },
    ],
  })
})

test('toolApprovalPolicy - who asks, who runs', async (t) => {
  const { toolApprovalPolicy } = await import('./notebookTools.ts')
  const blessed = new Set(['google_agent:doc-1'])
  const options = { isBlessed: (tool: string, key: string) => blessed.has(`${tool}:${key}`) }
  const statics = {
    toolName: 'google_agent',
    sessionKey: (input: Record<string, unknown>) => (typeof input.file === 'string' ? input.file : undefined),
    needsApprovalFor: (input: Record<string, unknown>) => typeof input.file === 'string',
  }
  const decide = (policy: ReturnType<typeof toolApprovalPolicy>, input: Record<string, unknown>) =>
    typeof policy === 'function' ? policy(input) : policy

  await t.step('a call the tool exempts runs, on a host with no blessings too', async () => {
    assert({
      given: 'a create mission on a host that cannot bless',
      should: 'be approved without asking',
      actual: await decide(toolApprovalPolicy(statics), { mission: 'Create a doc' }),
      expected: 'approved',
    })
  })
  await t.step('a targeted call asks unless its file is blessed', async () => {
    assert({
      given: 'a mission on a file nobody blessed, then one on a blessed file',
      should: 'ask for the first and run the second',
      actual: [
        await decide(toolApprovalPolicy(statics, options), { file: 'doc-9' }),
        await decide(toolApprovalPolicy(statics, options), { file: 'doc-1' }),
      ],
      expected: ['user-approval', 'approved'],
    })
  })
  await t.step('a tool with neither static keeps the plain gate', () => {
    assert({
      given: 'a gated tool declaring nothing',
      should: 'statically ask',
      actual: toolApprovalPolicy({ toolName: 'slack_post' }, options),
      expected: 'user-approval',
    })
  })
})

// ── A blank is no value ────────────────────────────────────────────────

test('withoutBlankStrings - drops the empty optional fields a model fills in', async () => {
  const { withoutBlankStrings } = await import('./notebookTools.ts')
  const input = { mission: 'Create a doc', file: '', import: '   ', reasoning: '', noOpen: false, limit: 0, tags: [] }
  const clean = withoutBlankStrings(input)
  assert({
    given: 'an input with blank strings beside real values',
    should:
      'drop the blanks and keep everything else — false, zero and an empty list included — leaving the original as it was',
    expected: {
      clean: { mission: 'Create a doc', noOpen: false, limit: 0, tags: [] },
      originalKeys: ['mission', 'file', 'import', 'reasoning', 'noOpen', 'limit', 'tags'],
    },
    actual: { clean, originalKeys: Object.keys(input) },
  })
})

test('toolApprovalPolicy - a blank target is no target', async () => {
  const { toolApprovalPolicy } = await import('./notebookTools.ts')
  const statics = {
    toolName: 'google_agent',
    sessionKey: (input: Record<string, unknown>) => (typeof input.file === 'string' ? input.file : undefined),
    needsApprovalFor: (input: Record<string, unknown>) =>
      typeof input.file === 'string' || typeof input.import === 'string',
  }
  const policy = toolApprovalPolicy(statics, { isBlessed: () => false })
  const decide = (input: Record<string, unknown>) => (typeof policy === 'function' ? policy(input) : policy)
  assert({
    given: 'a create mission whose model filled the file and import fields with blanks, then a real target',
    should: 'run the blank ones without asking and still ask for the real one',
    expected: ['approved', 'approved', 'user-approval'],
    actual: [
      await decide({ mission: 'Create a doc', file: '' }),
      await decide({ mission: 'x', file: '  ', import: '' }),
      await decide({ file: 'doc-9' }),
    ],
  })
})

test('runToolCommand - blank strings never reach the command', async () => {
  let seen: unknown
  const recording = {
    run: (_name: string, input: unknown) => {
      seen = input
      return Promise.resolve(CommandResult.success({ ok: true }))
    },
  } as unknown as CommandService
  await runToolCommand(recording, ENTRY, { mission: 'Create a doc', reasoning: '', file: '  ', noOpen: false })
  assert({
    given: 'a call whose model sent an empty reasoning profile and a blank file',
    should: 'hand the command only the fields that say something',
    expected: { mission: 'Create a doc', noOpen: false },
    actual: seen,
  })
})

test('runToolCommand - a host signal scopes the command run', async () => {
  const seen: string[] = []
  const host = new AbortController()
  const scoped = {
    run: () => {
      seen.push('scoped.run')
      return Promise.resolve(CommandResult.success({}))
    },
  }
  const tasks = {
    withSignal: (signal: AbortSignal) => {
      seen.push(signal === host.signal ? 'withSignal(host)' : 'withSignal(other)')
      return scoped
    },
    run: () => {
      seen.push('run')
      return Promise.resolve(CommandResult.success({}))
    },
  } as unknown as CommandService
  await runToolCommand(tasks, ENTRY, {}, { signal: host.signal })
  await runToolCommand(tasks, ENTRY, {})
  assert({
    given: 'a call carrying the turn signal, then one without',
    should: 'run the first on a scope forked with that signal and the second on the plain scope',
    actual: seen,
    expected: ['withSignal(host)', 'scoped.run', 'run'],
  })
})
