import { spyOn } from 'bun:test'
import * as summaries from '#lib/notebook/enrich/summarize.ts'
import { assert, test } from '#test'
import { conversationTo, formatAudioConversation, summarizeAudioConversation } from './audioConversation.ts'

const FIRST =
  'Hello there. I hope all is well. The Atlas draft is ready. Please review it today. We can discuss it tomorrow. Thanks for your help.'
const SECOND = 'Dr. Jane Doe reviewed it. The estimate is $3.50 per item. It looks good. I will send it along.'
const RAW = `### Turn 1\n\n${FIRST}\n\n### Turn 2\n\n${SECOND}`

test('new audio topic summaries label the entire conversation in five to seven words', async () => {
  const labels = [
    'Atlas draft review and estimates',
    'Reviewing the Atlas draft and estimates',
    'Reviewing the Atlas draft and delivery estimates',
  ]
  const summarize = spyOn(summaries, 'summarizeTranscript')
  try {
    for (const label of labels) {
      summarize.mockResolvedValue(label)
      assert({
        given: 'a valid topic label for multiple audio turns',
        should: 'keep the label and give the summarizer every turn with its stated speaker',
        actual: [await summarizeAudioConversation(RAW, ['Jane Doe', 'Me']), summarize.mock.calls.at(-1)?.[0]],
        expected: [label, `Jane Doe: ${FIRST}\n\nMe: ${SECOND}`],
      })
    }
  } finally {
    summarize.mockRestore()
  }
})

test('unavailable or wrong-length audio summaries fall back to a short excerpt', async () => {
  const summarize = spyOn(summaries, 'summarizeTranscript')
  try {
    for (const reply of [undefined, 'Atlas review', 'Reviewing the Atlas draft and all the delivery estimates']) {
      summarize.mockResolvedValue(reply)
      assert({
        given: 'an unavailable model or a label outside five to seven words',
        should: 'use the spoken words without numbered headings or speaker labels',
        actual: await summarizeAudioConversation(RAW, ['Jane Doe', 'Me']),
        expected: 'Hello there. I hope all is well',
      })
    }
    summarize.mockResolvedValue(undefined)
    for (const [words, expected] of [
      ['Hello.', 'Audio message saying just Hello'],
      ['See you.', 'Audio message saying See you'],
      ['See you Friday.', 'Audio message saying See you Friday'],
      ['Review the Atlas plan.', 'Audio message saying Review the Atlas plan'],
    ]) {
      assert({
        given: 'a very short recording when summary generation is unavailable',
        should: 'still file a five to seven word label grounded in the recording',
        actual: await summarizeAudioConversation(`### Turn 1\n\n${words}`, ['Jane Doe']),
        expected,
      })
    }
  } finally {
    summarize.mockRestore()
  }
})

test('cancelling an audio summary cannot file a fallback instead', async () => {
  const controller = new AbortController()
  const summarize = spyOn(summaries, 'summarizeTranscript').mockImplementation(async (_text, options) => {
    assert({
      given: 'a cancellable audio import',
      should: 'pass cancellation to the summary model',
      actual: options?.signal,
      expected: controller.signal,
    })
    controller.abort()
    return undefined
  })
  try {
    let cancelled = false
    try {
      await summarizeAudioConversation(RAW, ['Jane Doe', 'Me'], { signal: controller.signal })
    } catch {
      cancelled = controller.signal.aborted
    }
    assert({
      given: 'an import cancelled while generating its topic label',
      should: 'stop before saving the message',
      actual: cancelled,
      expected: true,
    })
  } finally {
    summarize.mockRestore()
  }
})

test('audio messages use the stated speakers and lossless topical paragraphs', async () => {
  const body = await formatAudioConversation(RAW, ['Jane Doe', 'Me'], {
    chooseBreaks: async (turns) => {
      assert({
        given: 'sentences containing a title and a decimal',
        should: 'give the paragraph chooser whole sentences in each original audio file',
        actual: turns.map((turn) => turn.length),
        expected: [6, 4],
      })
      return [
        [2, 4, 6],
        [2, 4],
      ]
    },
  })
  assert({
    given: 'two files with speaker names and topic boundaries',
    should: 'save each word once, in order, under its speaker instead of numbered headings',
    actual: body,
    expected:
      '**Jane Doe:**\n\nHello there. I hope all is well.\n\nThe Atlas draft is ready. Please review it today.\n\nWe can discuss it tomorrow. Thanks for your help.\n\n**Me:**\n\nDr. Jane Doe reviewed it. The estimate is $3.50 per item.\n\nIt looks good. I will send it along.',
  })
})

test('invalid or unavailable paragraph choices still preserve every word in short paragraphs', async () => {
  const choices = [
    [],
    [[6], [4]],
    [[2, 2, 6], [2]],
    [
      [0, 3, 6],
      [2, 4],
    ],
    [[3, 99], [-1]],
    [[1.5, 6], [4]],
    null,
  ]
  for (const choice of choices) {
    const body = await formatAudioConversation(RAW, ['Jane Doe', 'Me'], {
      chooseBreaks: async () => {
        if (choice === null) throw new Error('Formatting unavailable')
        return choice
      },
    })
    assert({
      given: `invalid break positions ${JSON.stringify(choice)}`,
      should: 'fall back to at most three sentences per paragraph without dropping text',
      actual: body,
      expected:
        '**Jane Doe:**\n\nHello there. I hope all is well. The Atlas draft is ready.\n\nPlease review it today. We can discuss it tomorrow. Thanks for your help.\n\n**Me:**\n\nDr. Jane Doe reviewed it. The estimate is $3.50 per item.\n\nIt looks good. I will send it along.',
    })
  }
})

test('short messages need no model call and speaker names are literal text', async () => {
  const body = await formatAudioConversation('### Turn 1\n\nHello. How are you?', ['Jane *Doe*'], {
    chooseBreaks: async () => {
      throw new Error('Unexpected model call')
    },
  })
  assert({
    given: 'a short audio message',
    should: 'use one paragraph and escape markdown in the speaker name',
    actual: body,
    expected: '**Jane \\*Doe\\*:**\n\nHello. How are you?',
  })
})

test('missing audio boundaries and cancellation cannot silently file an incomplete message', async () => {
  const signal = AbortSignal.abort()
  for (const options of [
    { transcript: RAW, speakers: ['Jane Doe'], signal: undefined },
    { transcript: `Unassigned words\n\n${RAW}`, speakers: ['Jane Doe', 'Me'], signal: undefined },
    { transcript: RAW, speakers: ['Jane Doe', 'Me'], signal },
  ]) {
    let failed = false
    try {
      await formatAudioConversation(options.transcript, options.speakers, { signal: options.signal })
    } catch {
      failed = true
    }
    assert({
      given: 'unassignable text or a cancelled import',
      should: 'stop before filing',
      actual: failed,
      expected: true,
    })
  }
})

test('conversationTo names every other voice, once, in order of first turn', () => {
  assert({
    given: 'conversations opened by one speaker',
    should: 'answer the other speakers, and nobody for a lone voice',
    actual: [
      conversationTo(['Jane Doe', 'Joe Smith', 'Jane Doe'], 'Jane Doe'),
      conversationTo(['Joe Smith', 'Jane Doe', 'Sam Rivera', 'Jane Doe'], 'Joe Smith'),
      conversationTo(['Jane Doe'], 'Jane Doe'),
    ],
    expected: ['Joe Smith', 'Jane Doe, Sam Rivera', undefined],
  })
})
