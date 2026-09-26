import { assert, test } from '#test'
import type { StartFields } from './jobs.ts'
import { startArgs } from './startArgs.ts'

const PROPOSED = '2026-01-27 14:05'
const memo = { source: 'audio' as const, runKey: 'abc123', suggestedWhen: PROPOSED }
const fields = (over: Partial<StartFields>): StartFields => ({
  kind: 'meeting',
  when: PROPOSED,
  category: 'Professional',
  journalType: null,
  fresh: false,
  ...over,
})

test('CAF audio goes to one message with every turn and a fixed medium', () => {
  for (const files of [['/tmp/first.caf'], ['/tmp/first.caf', '/tmp/reply.CAF']]) {
    const start = startArgs(
      { ...memo, source: 'imessage-audio' },
      fields({
        kind: 'message',
        audioSpeakers: { 'first.caf': 'Jane Doe', 'reply.CAF': 'Me' },
      }),
      files,
    )
    assert({
      given: `${files.length} CAF files in one drop`,
      should: 'send the entire ordered group through the audio conversation pipeline',
      actual: [
        start.command,
        start.args.fromAudioTurns,
        start.args.audioSpeakers,
        start.args.medium,
        start.args.fromAudio,
        start.rawArgs,
      ],
      expected: [
        'message:new',
        files,
        ['Jane Doe', 'Me'].slice(0, files.length),
        'iMessage Audio',
        undefined,
        { _: [] },
      ],
    })
  }
})

test('a document starts a timed note with the work wording and a stable retry identity', () => {
  const start = startArgs(
    { source: 'document', runKey: null, suggestedWhen: '2025-01-01', id: 'import-one' },
    fields({
      kind: 'note',
      when: '2026-01-27 23:30 - 25:30',
      summary: 'Worked on the Atlas report',
      body: 'Revised the asks.',
    }),
    '/tmp/Atlas.pdf',
  )
  assert({
    given: 'a document with a work range on a different day from the file proposal',
    should: 'pass the range and user wording to notes:new without an audio pipeline',
    actual: {
      command: start.command,
      fromFile: start.args.fromFile,
      fromAudio: start.args.fromAudio,
      when: String(start.args.when),
      workWhen: start.args.workWhen,
      summary: start.args.summary,
      body: start.args.body,
      run: start.args.run,
    },
    expected: {
      command: 'notes:new',
      fromFile: '/tmp/Atlas.pdf',
      fromAudio: undefined,
      when: '2026-01-27 23:30',
      workWhen: '2026-01-27 23:30 - 25:30',
      summary: 'Worked on the Atlas report',
      body: 'Revised the asks.',
      run: 'import-one',
    },
  })
})

test('startArgs() — a when left as sky proposed it', () => {
  const start = startArgs(memo, fields({}), '/tmp/memo.m4a')
  assert({
    given: 'a memo filed as a meeting with the proposed when untouched',
    should: 'run meeting:new with the proposal as the default and as the clock, and nothing stated',
    actual: {
      command: start.command,
      when: String(start.args.when),
      clock: start.args.clock,
      source: start.args.fromVoiceMemo,
      run: start.args.run,
      category: start.args.category,
      rawArgs: start.rawArgs,
    },
    expected: {
      command: 'meeting:new',
      when: PROPOSED,
      clock: PROPOSED,
      source: '/tmp/memo.m4a',
      run: 'abc123',
      category: 'Professional Complete',
      rawArgs: { _: [] },
    },
  })
  const transcript = startArgs({ ...memo, source: 'transcript' }, fields({}), '/tmp/call.vtt')
  assert({
    given: 'a transcript with the proposed when untouched',
    should: 'go in by its own door, with the clock',
    actual: { source: transcript.args.fromZoomVtt, clock: transcript.args.clock, rawArgs: transcript.rawArgs },
    expected: { source: '/tmp/call.vtt', clock: PROPOSED, rawArgs: { _: [] } },
  })
})

test('startArgs() — a when the person changed', () => {
  const start = startArgs(memo, fields({ when: '2026-01-27 09:30' }), '/tmp/memo.m4a')
  assert({
    given: 'a memo whose When was typed over',
    should: 'state it, and pass no clock',
    actual: { when: String(start.args.when), clock: start.args.clock, rawArgs: start.rawArgs },
    expected: { when: '2026-01-27 09:30', clock: undefined, rawArgs: { _: [], when: '2026-01-27 09:30' } },
  })
})

test('startArgs() — a selected calendar slot is stated even when it matches the proposal', () => {
  const start = startArgs(memo, fields({ whenStated: true }), '/tmp/memo.m4a')
  assert({
    given: 'a recording dropped on a calendar slot at the proposed time',
    should: 'keep the selected time over anything the recording says',
    actual: { when: String(start.args.when), clock: start.args.clock, rawArgs: start.rawArgs },
    expected: { when: PROPOSED, clock: undefined, rawArgs: { _: [], when: PROPOSED } },
  })
})

test('startArgs() — a Meetings section drop chooses only the day', () => {
  for (const day of ['2026-01-27', '2026-01-26']) {
    const start = startArgs(memo, fields({ when: `${day} 14:05`, dayStated: true }), '/tmp/memo.m4a')
    assert({
      given: `a memo dropped on the Meetings section for ${day}, leaving the suggested clock time untouched`,
      should: 'state only the chosen date and preserve the original recording clock as context',
      actual: { when: String(start.args.when), day: start.args.day, clock: start.args.clock, rawArgs: start.rawArgs },
      expected: { when: `${day} 14:05`, day, clock: PROPOSED, rawArgs: { _: [] } },
    })
  }
  const edited = startArgs(memo, fields({ when: '2026-01-26 09:30', dayStated: true }), '/tmp/memo.m4a')
  assert({
    given: 'the time typed over after dropping on the Meetings section',
    should: 'state the full edited time',
    actual: { day: edited.args.day, clock: edited.args.clock, rawArgs: edited.rawArgs },
    expected: { day: '2026-01-26', clock: undefined, rawArgs: { _: [], when: '2026-01-26 09:30' } },
  })
})

test('startArgs() — the other doors', () => {
  const journal = startArgs(memo, fields({ kind: 'journal', journalType: 'Mood' }), '/tmp/memo.m4a')
  const note = startArgs(memo, fields({ kind: 'note', when: '2026-01-27 09:30' }), '/tmp/memo.m4a')
  assert({
    given: 'a memo filed as a journal entry, when untouched',
    should: 'run journal:new with its type and nothing stated',
    actual: {
      command: journal.command,
      types: journal.args.types,
      rawArgs: journal.rawArgs,
      clock: journal.args.clock,
    },
    expected: { command: 'journal:new', types: ['Mood'], rawArgs: { _: [] }, clock: undefined },
  })
  assert({
    given: 'a memo filed as a note, when changed',
    should: 'run notes:new with the when stated',
    actual: { command: note.command, rawArgs: note.rawArgs },
    expected: { command: 'notes:new', rawArgs: { _: [], when: '2026-01-27 09:30' } },
  })
  const event = startArgs(memo, fields({ kind: 'event' }), '/tmp/memo.m4a')
  assert({
    given: 'a memo filed as an event',
    should: 'run event:new by its voice-memo door, named as the meeting door names it',
    actual: { command: event.command, memo: event.args.fromVoiceMemo, audio: event.args.fromAudio },
    expected: { command: 'event:new', memo: '/tmp/memo.m4a', audio: undefined },
  })
})

test("startArgs() — a video's transcript", () => {
  const video = startArgs({ ...memo, source: 'srt' }, fields({ kind: 'video' }), '/tmp/talk.srt')
  assert({
    given: 'an .srt filed as a video, when left as proposed',
    should:
      'run video:new by its own door with the record key, the proposal as the default and as the clock, and nothing stated',
    actual: {
      command: video.command,
      source: video.args.fromSrt,
      when: String(video.args.when),
      clock: video.args.clock,
      run: video.args.run,
      category: video.args.category,
      rawArgs: video.rawArgs,
    },
    expected: {
      command: 'video:new',
      source: '/tmp/talk.srt',
      when: PROPOSED,
      clock: PROPOSED,
      run: 'abc123',
      category: 'Professional Complete',
      rawArgs: { _: [] },
    },
  })
})

test('startArgs() — a screenshot', () => {
  const shot = startArgs({ ...memo, source: 'image' }, fields({ kind: 'message' }), '/tmp/chat.png')
  const memoMessage = startArgs(memo, fields({ kind: 'message' }), '/tmp/memo.m4a')
  assert({
    given: 'a screenshot filed as a message, when left as proposed',
    should: 'run message:new by its image door with the proposal as the default, and nothing stated',
    actual: {
      command: shot.command,
      image: shot.args.fromImage,
      audio: shot.args.fromAudio,
      when: String(shot.args.when),
      category: shot.args.category,
      rawArgs: shot.rawArgs,
    },
    expected: {
      command: 'message:new',
      image: '/tmp/chat.png',
      audio: undefined,
      when: PROPOSED,
      category: 'Professional Complete',
      rawArgs: { _: [] },
    },
  })
  assert({
    given: 'a memo filed as a message',
    should: 'still go in by the audio door',
    actual: [memoMessage.args.fromAudio, memoMessage.args.fromImage],
    expected: ['/tmp/memo.m4a', undefined],
  })
})

test('startArgs() — text, from a .txt or dragged onto the day', () => {
  const run = (source: 'text' | 'selection', kind: 'message' | 'meeting') => {
    const start = startArgs({ ...memo, source }, fields({ kind }), '/tmp/imports/j1/chat.txt')
    return {
      command: start.command,
      text: start.args.fromText,
      others: [start.args.fromAudio, start.args.fromImage, start.args.fromVoiceMemo],
      when: String(start.args.when),
      clock: start.args.clock,
      rawArgs: start.rawArgs,
    }
  }
  const message = (clock: string | undefined) => ({
    command: 'message:new',
    text: '/tmp/imports/j1/chat.txt',
    others: [undefined, undefined, undefined],
    when: PROPOSED,
    clock,
    rawArgs: { _: [] },
  })
  assert({
    given: 'a .txt and a dragged text, each filed as a message with the when left as proposed',
    should: 'run message:new by its text door, with nothing stated',
    actual: [run('text', 'message'), run('selection', 'message')],
    expected: [message(undefined), message(undefined)],
  })
  assert({
    given: 'the same two filed as a meeting',
    should: "go in by the meeting's text door; only the file's clock goes as a clock, never the moment of a drop",
    actual: [run('text', 'meeting'), run('selection', 'meeting')].map(({ command, text, clock }) => ({
      command,
      text,
      clock,
    })),
    expected: [
      { command: 'meeting:new', text: '/tmp/imports/j1/chat.txt', clock: PROPOSED },
      { command: 'meeting:new', text: '/tmp/imports/j1/chat.txt', clock: undefined },
    ],
  })
})

test('startArgs carries who one audio message is to', () => {
  const clip = ['/tmp/first.caf']
  const one = (extra: Partial<StartFields>) =>
    startArgs(
      { ...memo, source: 'imessage-audio' },
      fields({ kind: 'message', audioSpeakers: { 'first.caf': 'Jane Doe' }, ...extra }),
      clip,
    )
  assert({
    given: 'one CAF clip, with and without a recipient',
    should: 'pass the recipient as the door command --to, and nothing otherwise',
    actual: [one({ to: 'Joe Smith' }).args.to, one({}).args.to],
    expected: ['Joe Smith', undefined],
  })
})
