import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { assert, test } from '#test'
import ChatEngine, {
  type ApprovalDecision,
  type ChatEngineEvent,
  type ModelInvocation,
  type ModelInvoker,
  timeStampLine,
  TurnError,
} from './mod.ts'

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
// Turn stamps
// ---------------------------------------------------------------------------

test('timeStampLine', () => {
  assert({
    given: 'a normal-hours notebook datetime',
    should: 'render a stamp carrying the weekday',
    actual: timeStampLine('2026-08-15 14:32'),
    expected: '[Time: 2026-08-15 Sat 14:32]',
  })
  assert({
    given: 'an extended-hours datetime crossing a month boundary',
    should: 'weekday the notebook date and append the de-extended wall-clock equivalent',
    actual: timeStampLine('2026-08-31 25:30'),
    expected: '[Time: 2026-08-31 Mon 25:30 notebook - wall clock 2026-09-01 01:30]',
  })
  assert({
    given: 'a datetime that does not parse as a date',
    should: 'pass it through without a weekday rather than throw',
    actual: timeStampLine('sometime later'),
    expected: '[Time: sometime later]',
  })
})

test('ChatEngine.appendUserMessage - stamps prefix the model-facing message, per merged chunk', async () => {
  const { engine, calls } = makeEngine([textResult('ok')])
  engine.appendUserMessage('first part', '2026-08-15 14:32')
  engine.appendUserMessage('second part', '2026-08-15 14:40')
  await engine.runTurn(TURN_OPTS)

  assert({
    given: 'two stamped user messages merged into one turn',
    should: 'keep each chunk behind its own time stamp',
    actual: calls[0].messages,
    expected: [
      {
        role: 'user',
        content: '[Time: 2026-08-15 Sat 14:32]\nfirst part\n\n[Time: 2026-08-15 Sat 14:40]\nsecond part',
      },
    ],
  })
})

test('ChatEngine.seedConversation - restamps user messages only', async () => {
  const { engine, calls } = makeEngine([textResult('ok')])
  engine.seedConversation([
    { role: 'user', content: 'earlier question', when: '2026-08-14 09:05' },
    { role: 'assistant', content: 'earlier answer', when: '2026-08-14 09:06' },
    { role: 'user', content: 'pre-stamp question' },
  ])
  engine.appendUserMessage('follow-up', '2026-08-15 14:32')
  await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a resumed conversation with stamped and pre-stamp messages',
    should: 'prefix stamped user messages, never assistant ones',
    actual: calls[0].messages,
    expected: [
      { role: 'user', content: '[Time: 2026-08-14 Fri 09:05]\nearlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'pre-stamp question\n\n[Time: 2026-08-15 Sat 14:32]\nfollow-up' },
    ],
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

// ---------------------------------------------------------------------------
// Failed turns
// ---------------------------------------------------------------------------

test('ChatEngine.runTurn - stream error throws a clamped TurnError with the tool trail', async () => {
  const { engine } = makeEngine([
    {
      ...textResult(''),
      steps: [
        {
          toolResults: [toolResult('notebook_tool', 'tc1', { query: 'atlas' }, { success: false, error: 'too long' })],
        },
      ],
      error: new Error('x'.repeat(50_000)),
    },
  ])
  engine.appendUserMessage('hi')

  let thrown: unknown
  try {
    await engine.runTurn(TURN_OPTS)
  } catch (err) {
    thrown = err
  }

  const turnError = thrown as TurnError
  assert({
    given: 'an invocation whose stream surfaced a mid-flight error after a tool ran',
    should: "throw a clamped TurnError carrying the failing round's tool records",
    actual: {
      name: turnError.name,
      clamped: turnError.message.length <= 2000,
      records: turnError.toolRecords,
    },
    expected: {
      name: 'TurnError',
      clamped: true,
      records: [
        {
          tool: 'notebook_tool',
          input: 'atlas',
          outcome: 'error',
          tokens: estimateTokens(JSON.stringify({ success: false, error: 'too long' })),
        },
      ],
    },
  })
})

test('ChatEngine.runTurn - a rejected invocation wraps, keeps its message, rolls back', async () => {
  const calls: Array<{ messages: unknown[] }> = []
  let invocations = 0
  const invokeModel: ModelInvoker = (args) => {
    const snapshot = JSON.parse(JSON.stringify(args.messages)) as Array<Record<string, unknown>>
    calls.push({ messages: snapshot.map(({ providerOptions: _, ...rest }) => rest) })
    invocations++
    if (invocations === 1) return Promise.reject(new Error('overloaded'))
    return Promise.resolve(textResult('recovered'))
  }
  const engine = new ChatEngine({
    model: {} as ConstructorParameters<typeof ChatEngine>[0]['model'],
    approvalHandler: () => Promise.resolve(APPROVE),
    invokeModel,
  })
  engine.appendUserMessage('hi')

  let thrown: unknown
  try {
    await engine.runTurn(TURN_OPTS)
  } catch (err) {
    thrown = err
  }

  engine.appendUserMessage('retry')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'an invocation that rejects outright (zero steps completed)',
    should: 'wrap in TurnError preserving the cause message, and start the next turn clean',
    actual: {
      failed: thrown instanceof TurnError,
      message: (thrown as Error).message,
      recovered: result.text,
      nextTurnMessages: calls[1].messages,
    },
    expected: {
      failed: true,
      message: 'overloaded',
      recovered: 'recovered',
      nextTurnMessages: [{ role: 'user', content: 'hi\n\nretry' }],
    },
  })
})

test('ChatEngine.runTurn - approval-round failure rolls the history back', async () => {
  const { engine, calls } = makeEngine(
    [
      textResult('', {
        content: [approvalRequest('ap1', 'tc1', 'poster', { message: 'hello' })],
        responseMessages: [
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'poster', input: { message: 'hello' } }],
          },
        ],
      }),
      { ...textResult(''), error: new Error('validation failed') },
      textResult('recovered'),
    ],
    [APPROVE],
  )
  engine.appendUserMessage('post it')

  let thrown: unknown
  try {
    await engine.runTurn(TURN_OPTS)
  } catch (err) {
    thrown = err
  }

  engine.appendUserMessage('retry')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a continuation that dies after the approval round already pushed tool_use + approvals',
    should: 'roll history back to the user message so the next turn starts clean',
    actual: {
      failed: thrown instanceof TurnError,
      recovered: result.text,
      nextTurnMessages: calls[2].messages,
    },
    expected: {
      failed: true,
      recovered: 'recovered',
      nextTurnMessages: [{ role: 'user', content: 'post it\n\nretry' }],
    },
  })
})

// ---------------------------------------------------------------------------
// The streamed reply
// ---------------------------------------------------------------------------

/**
 * Streams scripted pieces through the engine's sink before resolving,
 * one script per round — the SDK's chunk callbacks, minus the model.
 * This reaches the real accumulation path: the text the engine returns is
 * whatever these pieces became, never the response object's own text.
 */
function streamingInvoker(rounds: Array<{ pieces: string[]; response: ModelInvocation }>) {
  let round = 0
  const invokeModel: ModelInvoker = (args) => {
    const next = rounds[round++]
    if (!next) throw new Error(`streaming invoker exhausted after ${rounds.length} rounds`)
    for (const piece of next.pieces) args.sink.write(piece)
    return Promise.resolve(next.response)
  }
  return invokeModel
}

function engineWithInvoker(invokeModel: ModelInvoker, decisions: ApprovalDecision[] = []) {
  const seen: ChatEngineEvent[] = []
  const { approvalHandler } = scriptedApprover(decisions)
  const engine = new ChatEngine({
    model: {} as ConstructorParameters<typeof ChatEngine>[0]['model'],
    approvalHandler,
    invokeModel,
    onEvent: (event) => seen.push(event),
  })
  return { engine, seen }
}

const deltas = (events: ChatEngineEvent[]) => events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : []))

test('ChatEngine.runTurn - the reply is exactly what streamed', async () => {
  const { engine, seen } = engineWithInvoker(
    streamingInvoker([
      { pieces: ['Focus on ', 'the demo ', 'script.'], response: textResult('not the reply: the sink is') },
    ]),
  )
  engine.appendUserMessage('what should I focus on?')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a turn whose model streamed three pieces',
    should: 'hand each to the host in arrival order',
    actual: deltas(seen),
    expected: ['Focus on ', 'the demo ', 'script.'],
  })

  assert({
    given: 'the same turn',
    should: "return the streamed text as the reply, not the response object's text",
    actual: result.text,
    expected: 'Focus on the demo script.',
  })
})

test('ChatEngine.runTurn - a model path that streams nothing still delivers its text as a delta', async () => {
  const { invokeModel } = scriptedInvoker([textResult('hello there')])
  const { engine, seen } = engineWithInvoker(invokeModel)
  engine.appendUserMessage('hi')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a round whose invoker wrote nothing to the sink',
    should: 'emit the whole text as one delta and return it — hosts never need a fallback',
    actual: { deltas: deltas(seen), text: result.text },
    expected: { deltas: ['hello there'], text: 'hello there' },
  })
})

test('ChatEngine.runTurn - text across approval rounds is one reply, paragraph-separated', async () => {
  const { engine, seen } = engineWithInvoker(
    streamingInvoker([
      {
        pieces: ["I'll post that now."],
        response: textResult('', { content: [approvalRequest('ap1', 'tc1', 'slack_post', { message: 'hello team' })] }),
      },
      { pieces: ['Posted.'], response: textResult('') },
    ]),
    [APPROVE],
  )
  engine.appendUserMessage('post that for me')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'text before the approval prompt and text after it',
    should: 'save both as one reply with a paragraph break — what the host showed',
    actual: result.text,
    expected: "I'll post that now.\n\nPosted.",
  })

  assert({
    given: 'the same turn',
    should: 'have streamed exactly that, separator included',
    actual: deltas(seen).join(''),
    expected: result.text,
  })
})

test('ChatEngine.runTurn - a step boundary breaks the paragraph only when text follows', async () => {
  const invokeModel: ModelInvoker = (args) => {
    args.sink.write('Let me check.')
    args.sink.stepEnd()
    args.sink.write('Nothing new.')
    args.sink.stepEnd()
    return Promise.resolve(textResult(''))
  }
  const { engine } = engineWithInvoker(invokeModel)
  engine.appendUserMessage('anything new?')
  const result = await engine.runTurn(TURN_OPTS)

  assert({
    given: 'text on both sides of a step boundary, and a trailing boundary with nothing after it',
    should: 'separate the two paragraphs and end cleanly — no dangling separator',
    actual: result.text,
    expected: 'Let me check.\n\nNothing new.',
  })
})

test('ChatEngine.runTurn - turn-complete arrives last', async () => {
  const { engine, seen } = engineWithInvoker(
    streamingInvoker([{ pieces: ['Atlas ', 'ships Friday.'], response: textResult('') }]),
  )
  engine.appendUserMessage('when does atlas ship?')
  await engine.runTurn(TURN_OPTS)

  assert({
    given: 'a turn that streamed text',
    should: 'close the stream with turn-complete so a host can end its rendering on it',
    actual: seen.map((e) => e.type),
    expected: ['text-delta', 'text-delta', 'turn-complete'],
  })
})

test('ChatEngine.runTurn - a failed turn emits no terminal event', async () => {
  const { engine, seen } = engineWithInvoker(() => Promise.reject(new Error('overloaded')))
  engine.appendUserMessage('hi')

  let threw: unknown
  try {
    await engine.runTurn(TURN_OPTS)
  } catch (err) {
    threw = err
  }

  assert({
    given: 'a turn whose model call failed',
    should: 'throw TurnError and emit no turn-complete',
    actual: {
      isTurnError: threw instanceof TurnError,
      complete: seen.filter((e) => e.type === 'turn-complete').length,
    },
    expected: { isTurnError: true, complete: 0 },
  })
})
