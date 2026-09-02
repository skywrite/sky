import { assert, test } from '#test'
import { EventOutput, type OutputEvent, stripAnsi } from './EventOutput.ts'

function collect(): { events: OutputEvent[]; output: EventOutput } {
  const events: OutputEvent[] = []
  return { events, output: new EventOutput((event) => events.push(event)) }
}

test('EventOutput: lines, errors and streamed pieces', () => {
  const { events, output } = collect()
  output.log('Transcribing…')
  output.write('Okay, quick')
  output.error('Boom')
  assert({
    given: 'a log, a write and an error',
    should: 'become one event each, in order',
    actual: events,
    expected: [
      { type: 'line', text: 'Transcribing…', level: 'log', command: null, depth: 0 },
      { type: 'text', text: 'Okay, quick', command: null, depth: 0 },
      { type: 'line', text: 'Boom', level: 'error', command: null, depth: 0 },
    ],
  })
})

test('EventOutput: terminal colors', () => {
  const { events, output } = collect()
  output.log('\x1b[36mAnalyzing transcript...\x1b[39m')
  assert({
    given: 'a colored line',
    should: 'reach the sink without its escape codes',
    actual: events[0]?.type === 'line' ? events[0].text : null,
    expected: 'Analyzing transcript...',
  })
  assert({
    given: 'nested bold and color codes',
    should: 'strip to the words',
    actual: stripAnsi('\x1b[1m\x1b[33mbold\x1b[39m\x1b[22m'),
    expected: 'bold',
  })
})

test('EventOutput: a child command', () => {
  const { events, output } = collect()
  const child = output.child('audio:transcript:create')
  child.commandStart?.()
  child.log('File size: 3.90 MB')
  child.commandEnd?.('success')
  assert({
    given: 'a child that starts, logs and ends',
    should: 'carry its command name and depth and mark both boundaries',
    actual: events,
    expected: [
      { type: 'command-start', command: 'audio:transcript:create', depth: 1 },
      { type: 'line', text: 'File size: 3.90 MB', level: 'log', command: 'audio:transcript:create', depth: 1 },
      { type: 'command-end', command: 'audio:transcript:create', depth: 1, status: 'success' },
    ],
  })
})

test('EventOutput: the root', () => {
  const { events, output } = collect()
  output.commandStart?.()
  output.commandEnd?.('fail')
  output.table([{ a: 1 }])
  assert({
    given: 'a root handler with no command of its own',
    should: 'mark no boundary and render a table as one JSON line',
    actual: events,
    expected: [{ type: 'line', text: '[{"a":1}]', level: 'log', command: null, depth: 0 }],
  })
})
