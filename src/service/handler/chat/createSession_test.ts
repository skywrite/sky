import { assert, test } from '#test'
import { choiceLabel, toolOutputSink } from './createSession.ts'
import type { ToolOutputEvent } from './mod.ts'

const MISSION = 'google:agent'

/** Let a summarizer's promise land before looking at what was reported. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function narrate(sink: ReturnType<typeof toolOutputSink>, lines: string[], status: 'success' | 'error' = 'success') {
  sink({ type: 'command-start', command: MISSION, depth: 1 })
  for (const text of lines) sink({ type: 'line', text, level: 'log', command: MISSION, depth: 1 })
  sink({ type: 'command-end', command: MISSION, depth: 1, status })
}

test({ name: 'toolOutputSink - an ended run with lines gets its one line from the summarizer' }, async () => {
  const events: ToolOutputEvent[] = []
  const asked: Array<{ tool: string; lines: string[]; status: string }> = []
  const sink = toolOutputSink(
    (event) => events.push(event),
    (tool, lines, status) => {
      asked.push({ tool, lines, status })
      return Promise.resolve('Applied three updates to the plan')
    },
  )
  narrate(sink, ['◦ Mission started', '◦ Applied 3 update(s) to "Atlas Plan"'])
  await settled()
  assert({
    given: 'a run that printed two lines and ended',
    should: 'ask once, with the lines as shown and how it ended, and report the answer after the end',
    actual: { asked, events: events.map((e) => (e.type === 'tool-summary' ? `summary: ${e.text}` : e.type)) },
    expected: {
      asked: [
        { tool: 'google_agent', lines: ['Mission started', 'Applied 3 update(s) to "Atlas Plan"'], status: 'success' },
      ],
      events: ['tool-started', 'tool-line', 'tool-line', 'tool-finished', 'summary: Applied three updates to the plan'],
    },
  })
})

test({ name: 'toolOutputSink - a one-line run is its own label and asks for nothing' }, async () => {
  const events: ToolOutputEvent[] = []
  let asked = 0
  const sink = toolOutputSink(
    (event) => events.push(event),
    () => {
      asked++
      return Promise.resolve('never')
    },
  )
  narrate(sink, ['Checked 3 conversations'])
  await settled()
  assert({
    given: 'a run that said one thing',
    should: 'report no summary and never ask',
    actual: { asked, types: events.map((e) => e.type) },
    expected: { asked: 0, types: ['tool-started', 'tool-line', 'tool-finished'] },
  })
})

test({ name: 'toolOutputSink - a summarizer with nothing to say leaves the run unlabeled' }, async () => {
  const events: ToolOutputEvent[] = []
  const sink = toolOutputSink(
    (event) => events.push(event),
    () => Promise.resolve(null),
  )
  narrate(sink, ['Mission started', 'Nothing to change'], 'error')
  await settled()
  assert({
    given: 'a summarizer that answers null',
    should: 'report the end and no summary',
    actual: events.map((e) => e.type),
    expected: ['tool-started', 'tool-line', 'tool-line', 'tool-finished'],
  })
})

test({ name: 'toolOutputSink - without a summarizer the events are the three as before' }, async () => {
  const events: ToolOutputEvent[] = []
  const sink = toolOutputSink((event) => events.push(event))
  narrate(sink, ['Mission started', 'Applied 1 update(s)'])
  await settled()
  assert({
    given: 'a sink built with no summarizer',
    should: 'report start, lines, end, nothing more',
    actual: events.map((e) => e.type),
    expected: ['tool-started', 'tool-line', 'tool-line', 'tool-finished'],
  })
})

test({ name: 'choiceLabel - two profiles on one model carry their effort; a lone one keeps the bare name' }, () => {
  const all = {
    'default-fable-5.1': {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
    },
    'default-fable-5.1-high': {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      options: { effort: 'high', thinking: { type: 'adaptive' } },
    },
    'default-opus-5': { provider: 'anthropic', model: 'claude-opus-5', options: { effort: 'xhigh' } },
    'default-gpt-5.5': { provider: 'openai', model: 'gpt-5.5', options: { reasoningEffort: 'xhigh' } },
    mine: { provider: 'openai', model: 'gpt-5.5' },
  } as unknown as Parameters<typeof choiceLabel>[1]
  assert({
    given: 'a catalog where Fable 5.1 appears twice, once at each effort, and Opus 5 once',
    should: 'tell the twins apart by effort and leave the lone model bare',
    actual: Object.keys(all).map((name) => choiceLabel(name, all)),
    expected: [
      'Claude Fable 5.1 · xhigh',
      'Claude Fable 5.1 · high',
      'Claude Opus 5',
      'GPT 5.5 · xhigh',
      'GPT 5.5 · mine',
    ],
  })
})
