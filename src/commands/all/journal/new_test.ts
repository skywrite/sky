import { spyOn } from 'bun:test'
import mri from 'mri'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { commandDescriptionToSchema } from '#commands/lib/jsonSchema.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { Command, CommandResult, type CommandTypesRegistry } from '#commands/mod.ts'
import * as config from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { startArgs } from '#service/handler/import/startArgs.ts'
import * as sys from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import JournalNewTask from './new.ts'

const WHEN = new PlainDateTime('2031-03-16 08:00')
const NOW = new ZonedDateTime(WHEN, 'UTC')

// Exercise the real command definition and dispatcher without invoking AI or writing journals.
class CaptureJournalArgs extends Command {
  static override description = JournalNewTask.description

  async run({ args }: Parameters<JournalNewTask['run']>[0]) {
    return CommandResult.success({ types: args.types, fromAudio: args.fromAudio })
  }
}

async function withJournalService(parent: Record<string, unknown>, run: (tasks: CommandService) => Promise<void>) {
  const context = CommandContext.test(config, { notebookNow: NOW, systemNow: NOW })
  const tasks = new CommandService(context, { when: WHEN, ...parent })
  const load = spyOn(tasks, 'get').mockResolvedValue(CaptureJournalArgs)
  try {
    await run(tasks)
  } finally {
    load.mockRestore()
  }
}

test('journal:new CLI types accept comma-separated values and repeated flags', async () => {
  for (const flags of [
    ['--types', 'Mood, Health'],
    ['--types', 'Mood', '--types', 'Health'],
  ]) {
    const raw = mri(['journal:new', '--when', WHEN.toString(), ...flags])
    const args = await transformTypedParamsArgs(JournalNewTask.description.params!, raw)
    assert({
      given: flags.join(' '),
      should: 'resolve both CLI spellings to the same list of journal types',
      actual: args.types,
      expected: ['Mood', 'Health'],
    })
  }
})

test('journal:new run() supplies normalized arrays for strings, arrays and already-parsed CLI values', async () => {
  const cli = await transformTypedParamsArgs(JournalNewTask.description.params!, {
    _: ['journal:new'],
    when: WHEN,
    types: 'Mood, Health',
  })
  await withJournalService({}, async (tasks) => {
    for (const types of ['Mood, Health', ['Mood', ' Health '], cli.types]) {
      const result = await tasks.run('journal:new', { types })
      assert({
        given: `types supplied as ${JSON.stringify(types)}`,
        should: 'deliver the validated list to the handler without restoring the raw override',
        actual: result.data,
        expected: { types: ['Mood', 'Health'], fromAudio: undefined },
      })
    }
  })
})

test('journal:new types preserve defaults, inheritance and override precedence', async () => {
  for (const [parent, overrides, expected] of [
    [{}, {}, ['Mood']],
    [{ types: ['Health'] }, {}, ['Health']],
    [{ types: ['Health'] }, { types: 'Mood' }, ['Mood']],
    [{ types: ['Health'] }, { types: ['Gratitude'] }, ['Gratitude']],
    [{ types: ['Health'] }, { types: undefined }, ['Mood']],
  ] as const) {
    await withJournalService(parent, async (tasks) => {
      const result = await tasks.run('journal:new', overrides)
      assert({
        given: `parent ${JSON.stringify(parent)} and overrides ${JSON.stringify(overrides)}`,
        should: 'resolve overrides before inheritance and use the array default for a missing value',
        actual: result.data,
        expected: { types: expected, fromAudio: undefined },
      })
    })
  }
})

test('journal:new accepts the web importer array and custom audio journal names', async () => {
  const file = '/tmp/mock-journal-recording.m4a'
  const start = startArgs(
    { source: 'audio', runKey: null, suggestedWhen: WHEN.toString() },
    { kind: 'journal', when: WHEN.toString(), journalType: 'Reflection', category: 'Personal', fresh: false },
    file,
  )
  await withJournalService({}, async (tasks) => {
    const result = await tasks.run(start.command, start.args)
    assert({
      given: 'a journal import with a custom journal type',
      should: 'reach the handler with the full journal name and the recording path',
      actual: result.data,
      expected: { types: ['Reflection'], fromAudio: file },
    })
  })
})

test('journal:new array normalization does not mutate caller values or reuse a default list', async () => {
  await withJournalService({}, async (tasks) => {
    const types = [' Mood ']
    const first = await tasks.run('journal:new', { types })
    const defaulted = await tasks.run<{ types: string[] }>('journal:new')
    defaulted.data!.types.push('Health')
    const next = await tasks.run('journal:new')
    assert({
      given: 'an array override needing trimming and a caller that mutates a previous default result',
      should: 'normalize without mutating input and allocate a fresh default for the next run',
      actual: [types, first.data, next.data],
      expected: [[' Mood '], { types: ['Mood'], fromAudio: undefined }, { types: ['Mood'], fromAudio: undefined }],
    })
  })
})

test('journal:new audio imports use the full custom type in the journal document', async () => {
  const context = CommandContext.test(config, { notebookNow: NOW, systemNow: NOW })
  const children = new CommandService(context)
  const clean = spyOn(children, 'run').mockImplementation(async (name) => {
    if (name !== 'audio:transcript:clean') throw new Error(`Unexpected command: ${name}`)
    return CommandResult.success({
      cleanedText: 'A mock reflection.',
      who: [],
      rel: [],
      appliedCount: 0,
      skippedCount: 0,
    })
  })
  class ImportJournal extends JournalNewTask {
    override run(call: Parameters<JournalNewTask['run']>[0]) {
      return super.run({ ...call, tasks: children })
    }
  }
  const tasks = new CommandService(context)
  const load = spyOn(tasks, 'get').mockResolvedValue(ImportJournal)
  const writes: string[] = []
  const write = spyOn(DayDirFileWriter.prototype, 'write').mockImplementation(async (file, content) => {
    writes.push(content)
    return file
  })
  const terminal = spyOn(sys, 'isTerminal').mockReturnValue(false)
  try {
    const start = startArgs(
      { source: 'audio', runKey: null, suggestedWhen: WHEN.toString() },
      { kind: 'journal', when: WHEN.toString(), journalType: 'Reflection', category: 'Personal', fresh: false },
      '/tmp/mock-journal-recording.m4a',
    )
    const result = await tasks.run(start.command, start.args)
    assert({
      given: 'a web import selecting the custom Reflection journal type',
      should: 'create one journal with the complete type name and cleaned transcript',
      actual: {
        ok: result.ok,
        writes: writes.length,
        title: writes[0]?.split('\n').find((line) => line.startsWith('# **')),
        tagged: writes[0]?.includes('Journal/Reflection'),
        body: writes[0]?.includes('A mock reflection.'),
      },
      expected: {
        ok: true,
        writes: 1,
        title: '# **Reflection: 2031-03-16 - Sun - 08:00**',
        tagged: true,
        body: true,
      },
    })
  } finally {
    terminal.mockRestore()
    write.mockRestore()
    load.mockRestore()
    clean.mockRestore()
  }
})

test('journal:new CLI audio validation still requires explicitly supplied types', async () => {
  const rawArgs = mri(['journal:new', '--when', WHEN.toString(), '--from-audio', '/tmp/mock-recording.m4a'])
  const args = await transformTypedParamsArgs(JournalNewTask.description.params!, rawArgs)
  const validate = JournalNewTask.description.postProcess![0]
  assert({
    given: 'CLI audio input with no --types despite the ordinary Mood default',
    should: 'keep requiring the user to choose the audio journal type explicitly',
    actual: [
      args.types,
      validate(args, rawArgs, JournalNewTask.description),
      validate(args, { ...rawArgs, types: 'Reflection' }, JournalNewTask.description),
    ],
    expected: [['Mood'], '--from-audio requires --types to be specified (e.g. --types "Reflection")', undefined],
  })
})

test('journal:new rejects malformed type lists before executing', async () => {
  await withJournalService({}, async (tasks) => {
    const execute = spyOn(CaptureJournalArgs.prototype, 'run')
    try {
      for (const types of [true, 12, null, [], ['Mood', 12], [['Mood']], '', 'Mood,', [' ']]) {
        let message = ''
        try {
          await tasks.run('journal:new', { types })
        } catch (error) {
          message = (error as Error).message
        }
        assert({
          given: `invalid types ${JSON.stringify(types)}`,
          should: 'fail validation before journal creation',
          actual: {
            rejected: message.startsWith('Validation failed for "types"'),
            executions: execute.mock.calls.length,
          },
          expected: { rejected: true, executions: 0 },
        })
      }
    } finally {
      execute.mockRestore()
    }
  })
})

test('journal:new exposes an optional array of nonempty names to tools', () => {
  const schema = commandDescriptionToSchema(JournalNewTask.description)
  assert({
    given: 'journal:new command metadata',
    should: 'advertise the array input, preserve validation and allow callers to use the default',
    actual: {
      type: schema.properties.types.type,
      items: schema.properties.types.items,
      minimum: schema.properties.types.minItems,
      required: schema.required?.includes('types') ?? false,
    },
    expected: { type: 'array', items: { type: 'string', minLength: 1 }, minimum: 1, required: false },
  })
})

function _verifyJournalTypes() {
  type Input = Partial<CommandTypesRegistry['journal:new']['paramsIn']>
  type Resolved = Parameters<JournalNewTask['run']>[0]['args']
  const allowed: Input[] = [{}, { types: 'Mood, Health' }, { types: ['Mood', 'Health'] }]
  const names: Resolved['types'] = ['Mood']
  // @ts-expect-error handlers receive arrays, never the accepted string input
  const raw: Resolved['types'] = 'Mood'
  // @ts-expect-error the default guarantees a resolved array
  const missing: Resolved['types'] = undefined
  // @ts-expect-error journal input arrays contain only strings
  const invalid: Input = { types: [12] }
}
