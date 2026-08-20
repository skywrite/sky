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
import { runToolCommand } from './_tools.ts'

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
    should: 'deliver only well-formed title+url pairs, labeled with the tool name',
    actual: seen,
    expected: [
      {
        toolName: 'fake_tool',
        files: [{ title: 'Atlas Revenue Model', url: 'https://docs.google.com/spreadsheets/d/f1' }],
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
