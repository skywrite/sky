import { assert, test } from '#test'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import ChatEngine, { type ApprovalDecision, type ModelInvocation, type ModelInvoker } from './mod.ts'

// ---------------------------------------------------------------------------
// Scripted fakes
// ---------------------------------------------------------------------------

/**
 * Plays back one ModelInvocation per call and snapshots what each call saw.
 * The cache-tail providerOptions annotation is stripped from the snapshot —
 * it is prompt-cache transport, not conversation content.
 */
function scriptedInvoker(responses: ModelInvocation[]) {
  const calls: Array<{ messages: unknown[] }> = []
  const invokeModel: ModelInvoker = (args) => {
    const snapshot = JSON.parse(JSON.stringify(args.messages)) as Array<Record<string, unknown>>
    calls.push({ messages: snapshot.map(({ providerOptions: _, ...rest }) => rest) })
    const next = responses[calls.length - 1]
    if (!next) throw new Error(`scripted invoker exhausted after ${responses.length} responses`)
    return Promise.resolve(next)
  }
  return { invokeModel, calls }
}

/** Plays back one ApprovalDecision per ask and records what was asked. */
function scriptedApprover(decisions: ApprovalDecision[]) {
  const asked: Array<{ toolName: string; input: unknown }> = []
  const approvalHandler = (toolCall: { toolName: string; input: unknown }) => {
    asked.push(toolCall)
    const next = decisions[asked.length - 1]
    if (!next) throw new Error(`scripted approver exhausted after ${decisions.length} decisions`)
    return Promise.resolve(next)
  }
  return { approvalHandler, asked }
}

const APPROVE: ApprovalDecision = { approved: true, reason: 'User approved' }
const DECLINE: ApprovalDecision = { approved: false, reason: 'User declined. Do not request this tool again.' }

function textResult(text: string, extra: Partial<ModelInvocation> = {}): ModelInvocation {
  return { text, content: [], steps: [], responseMessages: [], ...extra }
}

function approvalRequest(approvalId: string, toolCallId: string, toolName: string, input: unknown) {
  return { type: 'tool-approval-request', approvalId, toolCall: { toolCallId, toolName, input } }
}

function toolResult(toolName: string, toolCallId: string, input: unknown, output: unknown) {
  return { toolName, toolCallId, input, output }
}

const TURN_OPTS = { instructions: ['system prompt', 'context prompt'], tools: {}, toolApproval: {} }

function makeEngine(responses: ModelInvocation[], decisions: ApprovalDecision[] = []) {
  const { invokeModel, calls } = scriptedInvoker(responses)
  const { approvalHandler, asked } = scriptedApprover(decisions)
  const engine = new ChatEngine({
    // The scripted invoker never touches the model config.
    model: {} as ConstructorParameters<typeof ChatEngine>[0]['model'],
    approvalHandler,
    invokeModel,
  })
  return { engine, calls, asked }
}

// ---------------------------------------------------------------------------
// Plain turns
// ---------------------------------------------------------------------------

test('ChatEngine.runTurn', async () => {
  const { engine, calls } = makeEngine([
    textResult('hello there', {
      steps: [
        {
          toolResults: [
            toolResult('web_search', 'tc1', { query: 'atlas news' }, [{ url: 'https://a' }, { url: 'https://b' }]),
          ],
        },
      ],
    }),
  ])
  engine.appendUserMessage('hi')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a turn where the model searched and answered',
    should: 'return the text, the source URLs, and one ok tool record',
    actual: {
      text: result.text,
      sourceUrls: result.sourceUrls,
      toolRecords: result.toolRecords,
      exhausted: result.approvalRoundsExhausted,
      firstCallMessages: calls[0].messages,
    },
    expected: {
      text: 'hello there',
      sourceUrls: ['https://a', 'https://b'],
      toolRecords: [
        {
          tool: 'web_search',
          input: 'atlas news',
          outcome: 'ok',
          tokens: estimateTokens(JSON.stringify([{ url: 'https://a' }, { url: 'https://b' }])),
        },
      ],
      exhausted: false,
      firstCallMessages: [{ role: 'user', content: 'hi' }],
    },
  })
})

test('ChatEngine.appendUserMessage - merge rule', async () => {
  const { engine, calls } = makeEngine([textResult('ok')])
  engine.appendUserMessage('first part')
  engine.appendUserMessage('second part')
  await engine.runTurn(TURN_OPTS)

  assert({
    given: 'two user messages appended with no assistant reply between',
    should: 'merge them into a single alternating-role message',
    actual: calls[0].messages,
    expected: [{ role: 'user', content: 'first part\n\nsecond part' }],
  })
})

test('ChatEngine.seedConversation', async () => {
  const { engine, calls } = makeEngine([textResult('ok')])
  engine.seedConversation([
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
  ])
  engine.appendUserMessage('follow-up')
  await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a resumed conversation seeded before the next turn',
    should: 'replay the history ahead of the new message',
    actual: calls[0].messages.map((m) => (m as { role: string }).role),
    expected: ['user', 'assistant', 'user'],
  })
})

// ---------------------------------------------------------------------------
// Approval rounds
// ---------------------------------------------------------------------------

test('ChatEngine.runTurn - approved tool recorded once', async () => {
  const executed = toolResult('slack_post', 'tc1', { message: 'hello team' }, { success: true })
  const { engine, calls, asked } = makeEngine(
    [
      textResult('', {
        content: [approvalRequest('ap1', 'tc1', 'slack_post', { message: 'hello team' })],
        responseMessages: [{ role: 'assistant', content: 'requesting approval' }],
      }),
      // The approved call executes at the start of the continuation and can
      // surface in steps, content parts, AND tool response messages — the
      // engine must record it exactly once.
      textResult('posted!', {
        steps: [{ toolResults: [executed] }],
        content: [{ type: 'tool-result', ...executed }],
        responseMessages: [{ role: 'tool', content: [{ type: 'tool-result', ...executed }] }],
      }),
    ],
    [APPROVE],
  )
  engine.appendUserMessage('post it')
  const result = await engine.runTurn(TURN_OPTS)

  const approvalMessage = (calls[1].messages as Array<{ role: string; content: unknown }>).find(
    (m) => m.role === 'tool',
  )
  assert({
    given: 'an approved tool call surfacing in all three result shapes',
    should: 'send the approval back and record the execution exactly once',
    actual: {
      asked,
      approvalMessage,
      toolRecords: result.toolRecords,
      text: result.text,
    },
    expected: {
      asked: [{ toolName: 'slack_post', input: { message: 'hello team' } }],
      approvalMessage: {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap1', approved: true, reason: 'User approved' }],
      },
      toolRecords: [
        {
          tool: 'slack_post',
          input: 'hello team',
          outcome: 'ok',
          tokens: estimateTokens(JSON.stringify({ success: true })),
        },
      ],
      text: 'posted!',
    },
  })
})

test('ChatEngine.runTurn - denial excludes the echoed result', async () => {
  const { engine, asked } = makeEngine(
    [
      textResult('', {
        content: [approvalRequest('ap1', 'tc1', 'slack_post', { message: 'hello' })],
        responseMessages: [],
      }),
      // The SDK echoes a result part for the denied call id — it must not
      // be double-recorded as an execution.
      textResult('understood, not posting', {
        content: [{ type: 'tool-result', toolName: 'slack_post', toolCallId: 'tc1', output: { success: false } }],
      }),
    ],
    [DECLINE],
  )
  engine.appendUserMessage('post it')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a denied tool whose call id echoes back as a result part',
    should: 'record only the denial',
    actual: { asked: asked.length, toolRecords: result.toolRecords },
    expected: {
      asked: 1,
      toolRecords: [{ tool: 'slack_post', input: 'hello', outcome: 'denied' }],
    },
  })
})

test('ChatEngine.runTurn - repeat requests auto-denied', async () => {
  const { engine, calls, asked } = makeEngine(
    [
      textResult('', {
        content: [
          approvalRequest('ap1', 'tc1', 'slack_post', { message: 'one' }),
          approvalRequest('ap2', 'tc2', 'slack_post', { message: 'two' }),
        ],
        responseMessages: [],
      }),
      textResult('moving on'),
    ],
    [DECLINE],
  )
  engine.appendUserMessage('post twice')
  const result = await engine.runTurn(TURN_OPTS)

  const approvalMessage = (calls[1].messages as Array<{ role: string; content: unknown }>).find(
    (m) => m.role === 'tool',
  )
  assert({
    given: 'a second request for a tool already denied this turn',
    should: 'auto-deny it without consulting the handler again',
    actual: {
      asked: asked.length,
      responses: (approvalMessage?.content as Array<{ approved: boolean; reason?: string }>).map((a) => a.reason),
      toolRecords: result.toolRecords.map((t) => ({ tool: t.tool, input: t.input, outcome: t.outcome })),
    },
    expected: {
      asked: 1,
      responses: [
        'User declined. Do not request this tool again.',
        'User already denied slack_post. Do not request it again.',
      ],
      toolRecords: [
        { tool: 'slack_post', input: 'one', outcome: 'denied' },
        { tool: 'slack_post', input: 'two', outcome: 'denied' },
      ],
    },
  })
})

test('ChatEngine.runTurn - sources survive approval rounds', async () => {
  const { engine } = makeEngine(
    [
      textResult('', {
        content: [approvalRequest('ap1', 'tc2', 'slack_post', { message: 'summary' })],
        steps: [{ toolResults: [toolResult('web_search', 'tc1', { query: 'q' }, [{ url: 'https://round-one' }])] }],
        responseMessages: [],
      }),
      textResult('done', {
        steps: [{ toolResults: [toolResult('web_search', 'tc3', { query: 'q2' }, [{ url: 'https://round-two' }])] }],
      }),
    ],
    [APPROVE],
  )
  engine.appendUserMessage('search then post')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'web searches in the approval round and in the continuation',
    should: 'collect source URLs and tool records from every round',
    actual: {
      sourceUrls: result.sourceUrls,
      searches: result.toolRecords.filter((t) => t.tool === 'web_search').length,
    },
    expected: {
      sourceUrls: ['https://round-one', 'https://round-two'],
      searches: 2,
    },
  })
})

test('ChatEngine.runTurn - approval rounds capped', async () => {
  const requesting = () =>
    textResult('', {
      content: [approvalRequest('ap', 'tc', 'slack_post', { message: 'again' })],
      responseMessages: [],
    })
  const { engine, calls, asked } = makeEngine(
    [requesting(), requesting(), requesting(), requesting()],
    [APPROVE, APPROVE, APPROVE],
  )
  engine.appendUserMessage('loop forever')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a model that requests approval on every continuation',
    should: 'stop after the round cap and report the cutoff',
    actual: { exhausted: result.approvalRoundsExhausted, invocations: calls.length, asked: asked.length },
    expected: { exhausted: true, invocations: 4, asked: 3 },
  })
})
