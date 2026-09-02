import * as config from '#config'
import { assert, test } from '#test'
import CommandContext from './CommandContext.ts'
import { runCommand, type RunEvent } from './runCommand.ts'

/** Drive a run: reply to each question with `answer`, collect everything else. */
async function drive(answer: unknown, stopAtPrompt = false) {
  const events: RunEvent[] = []
  const gen = runCommand('test:progress', { context: CommandContext.test(config) })
  let step = await gen.next()
  while (!step.done) {
    const event = step.value
    events.push(event)
    if (event.type === 'prompt') {
      if (stopAtPrompt) {
        await gen.return(undefined as never)
        return { events, result: null }
      }
      event.reply(answer)
    }
    step = await gen.next()
  }
  return { events, result: step.value }
}

test('runCommand: one stream, questions answered through the event', async () => {
  const { events, result } = await drive('Atlas')
  const shape = events.map((e) =>
    e.type === 'stage'
      ? `stage:${e.id}${e.detail ? `:${e.detail}` : ''}`
      : e.type === 'tick'
        ? `tick:${e.done}/${e.total}`
        : e.type === 'prompt'
          ? `prompt:${e.request.kind}`
          : e.type === 'line'
            ? `line:${e.text}`
            : e.type === 'text'
              ? `text:${e.text}`
              : e.type === 'plan'
                ? `plan:${e.steps.map((s) => s.id).join('+')}`
                : e.type,
  )
  assert({
    given: 'a command that plans, reports, asks and counts',
    should: 'yield each in order, resume on the reply, and end with the result',
    actual: { shape, status: result?.status, data: result?.data },
    expected: {
      shape: [
        'command-start',
        'plan:read+write',
        'stage:read',
        'line:read one file',
        'prompt:text',
        'stage:write:Atlas',
        'tick:1/2',
        'tick:2/2',
        'text:done.',
        'command-end',
      ],
      status: 'success',
      data: { name: 'Atlas' },
    },
  })
})

test('runCommand: a null reply is a cancel the command sees', async () => {
  const { result } = await drive(null)
  assert({
    given: 'a question answered with nothing',
    should: 'let the command fail itself as cancelled',
    actual: [result?.status, result?.message],
    expected: ['fail', 'Cancelled'],
  })
})

test('runCommand: a host that stops reading cancels the run', async () => {
  const { events, result } = await drive('never', true)
  assert({
    given: 'a loop left at the first question',
    should: 'end without a result, the question left unanswered',
    actual: [result, events.at(-1)?.type],
    expected: [null, 'prompt'],
  })
})

test('runCommand: the host signal reaches the command', async () => {
  const controller = new AbortController()
  const gen = runCommand('test:progress', { context: CommandContext.test(config), signal: controller.signal })
  let step = await gen.next()
  let reached: string | null = null
  while (!step.done) {
    if (step.value.type === 'prompt') {
      controller.abort()
      // The abort answers the question with null; no reply from us.
    }
    if (step.value.type === 'stage') reached = step.value.id
    step = await gen.next()
  }
  assert({
    given: 'an abort while a question is open',
    should: 'answer it null so the command fails as cancelled at the read step',
    actual: [step.value.status, step.value.message, reached],
    expected: ['fail', 'Cancelled', 'read'],
  })
})
