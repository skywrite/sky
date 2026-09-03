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
})
