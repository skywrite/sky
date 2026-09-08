import { spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as prompts from '@clack/prompts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import { outputFile, readTextFile, walk } from '#shared/fs/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import TrackAskTask from './ask.ts'
import * as moment from './lib/moment.ts'
import * as parse from './lib/parse.ts'

interface AskScenario {
  today?: string
  storage?: 'weekly' | 'yearly'
  answers: (string | symbol)[]
  responses?: unknown[]
  confirmations?: (boolean | symbol)[]
}

/** Exercise the real capture loop and files with scripted prompts and model responses. */
async function askScenario(scenario: AskScenario) {
  const root = await mkdtemp('/tmp/sky-track-ask-test-')
  const today = new PlainDate(scenario.today ?? '2031-03-13')
  const context = CommandContext.test({
    ...config,
    DIR_TRACKING: path.join(root, 'tracking'),
    DIR_TIME: path.join(root, 'time'),
    DIR_DATA_TRACKING: path.join(root, 'data/tracking'),
  })
  const answers = [...scenario.answers]
  const responses = [...(scenario.responses ?? [])]
  const confirmations = [...(scenario.confirmations ?? [true])]
  const questions: string[] = []
  const previews: string[] = []
  const validationErrors: string[] = []
  const tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  const clock = spyOn(moment, 'currentMoment').mockResolvedValue({ date: today, time: '9:15' })
  const parsing = spyOn(parse, 'parseEntry').mockImplementation(async (def, _entry, now) => {
    if (responses.length === 0) throw new Error('Unexpected model call')
    const response = responses.shift()
    return response === null ? null : parse.parseEntryResponse(def, response, new PlainDate(now.date))
  })
  const text = spyOn(prompts, 'text').mockImplementation(async (options) => {
    questions.push(options.message)
    while (answers.length > 0) {
      const answer = answers.shift()!
      if (typeof answer === 'symbol') return answer
      const error = options.validate?.(answer)
      if (!error) return answer
      validationErrors.push(String(error))
    }
    throw new Error(`No scripted answer for ${options.message}`)
  })
  const confirm = spyOn(prompts, 'confirm').mockImplementation(async ({ message }) => {
    previews.push(message)
    if (confirmations.length === 0) throw new Error('Unexpected confirmation')
    return confirmations.shift()!
  })
  const spinner = spyOn(prompts, 'spinner').mockReturnValue({ start() {}, stop() {}, message() {} })
  const cancel = spyOn(prompts, 'isCancel').mockImplementation((value): value is symbol => typeof value === 'symbol')

  try {
    await outputFile(
      path.join(context.config.DIR_TRACKING, 'active/hydration.md'),
      [
        '---',
        'name: hydration',
        `storage: ${scenario.storage ?? 'yearly'}`,
        'category: health',
        'question: How many cups today?',
        'columns:',
        '  - name: time',
        '    type: time',
        '  - name: cups',
        '    type: number',
        '  - name: notes',
        '    type: text',
        '---',
        '# Hydration',
      ].join('\n'),
    )
    const result = await new TrackAskTask().run({
      args: { name: 'hydration' },
      context,
      tasks: new CommandService(context),
      rawArgs: { _: [] },
    })
    const files: Record<string, string> = {}
    for await (const file of walk(root, { exts: ['.csv'], includeDirs: false })) {
      files[path.relative(root, file.path)] = await readTextFile(file.path)
    }
    return { result: result.data, files, questions, previews, validationErrors, modelCalls: parsing.mock.calls.length }
  } finally {
    cancel.mockRestore()
    spinner.mockRestore()
    confirm.mockRestore()
    text.mockRestore()
    parsing.mockRestore()
    clock.mockRestore()
    if (tty) Object.defineProperty(process.stdout, 'isTTY', tty)
    else Reflect.deleteProperty(process.stdout, 'isTTY')
    await rm(root, { recursive: true, force: true })
  }
}

test('track:ask: a stated calendar day reaches the preview and saved row', async () => {
  const actual = await askScenario({
    answers: ['0 at 18:45 on Wednesday (Mar 12)'],
    responses: [{ date: '2031-03-12', values: { time: '18:45', cups: 0 } }],
  })
  assert({
    given: 'a measurement for the previous day despite a question asking about today',
    should: 'preview and save the stated date, time, and zero value',
    actual: { previews: actual.previews, files: actual.files, recorded: actual.result?.recorded },
    expected: {
      previews: ['Write: 2031-03-12, 18:45, 0'],
      files: { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-12, 18:45, 0\n' },
      recorded: ['hydration'],
    },
  })
})

test('track:ask: backdating selects the entry date’s week and year files', async () => {
  const weekly = await askScenario({
    today: '2031-03-17',
    storage: 'weekly',
    answers: ['2 yesterday at 18:45'],
    responses: [{ date: '2031-03-16', values: { time: '18:45', cups: 2 } }],
  })
  const yearly = await askScenario({
    today: '2032-01-02',
    answers: ['2 on December 31 at 18:45'],
    responses: [{ date: '2031-12-31', values: { time: '18:45', cups: 2 } }],
  })
  assert({
    given: 'a previous-week entry and a previous-year entry',
    should: 'write only the files containing their respective entry dates',
    actual: [weekly.files, yearly.files],
    expected: [
      {
        [`time/${weekDir('2031-03-16')}/_tracking/health/hydration.csv`]:
          '"day", "time", "cups", "notes"\nSU, 18:45, 2\n',
      },
      { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-12-31, 18:45, 2\n' },
    ],
  })
})

test('track:ask: undated answers keep calendar defaults and the scalar fast path', async () => {
  const scalar = await askScenario({ answers: ['2'] })
  const prose = await askScenario({
    answers: ['2 after a walk'],
    responses: [{ date: null, values: { cups: 2, notes: 'after a walk' } }],
  })
  assert({
    given: 'a bare number and prose without a stated date or time',
    should: 'use the calendar day and current time, calling the model only for prose',
    actual: [scalar.files, scalar.modelCalls, scalar.previews, prose.files, prose.questions.length],
    expected: [
      { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-13, 9:15, 2\n' },
      0,
      [],
      {
        'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-13, 9:15, 2, "after a walk"\n',
      },
      1,
    ],
  })
})

test('track:ask: unresolved dates are clarified without losing parsed values', async () => {
  for (const date of ['unclear', '2031-02-29', undefined]) {
    const actual = await askScenario({
      answers: ['2 at 18:45 on that day', '', '03-12', '2031-02-29', '2031-03-12'],
      responses: [{ date, values: { cups: 2, time: '18:45' } }],
    })
    assert({
      given: `a model date requiring clarification (${String(date)})`,
      should: 'require a valid full date, keep the values, and confirm the corrected row',
      actual: [actual.questions, actual.validationErrors.length, actual.previews, actual.files],
      expected: [
        ['How many cups today?', 'Which date should this entry use? (YYYY-MM-DD)'],
        3,
        ['Write: 2031-03-12, 18:45, 2'],
        { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-12, 18:45, 2\n' },
      ],
    })
  }
})

test('track:ask: parse failure asks the date before confirming the fallback row', async () => {
  const actual = await askScenario({
    answers: ['2 yesterday', '2', '', '2031-03-12'],
    responses: [null],
  })
  assert({
    given: 'a model failure on a dated entry',
    should: 'collect the date along with manual values and confirm before writing',
    actual: [actual.questions, actual.previews, actual.files],
    expected: [
      ['How many cups today?', 'cups', 'notes', 'Which date should this entry use? (YYYY-MM-DD)'],
      ['Write: 2031-03-12, 9:15, 2'],
      { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-12, 9:15, 2\n' },
    ],
  })
})

test('track:ask: rejecting a dated row resets the next answer’s date', async () => {
  const actual = await askScenario({
    answers: ['2 yesterday', '3'],
    responses: [{ date: '2031-03-12', values: { cups: 2 } }],
    confirmations: [false],
  })
  assert({
    given: 'a rejected backdated row followed by a bare value',
    should: 'save only the new answer on today’s date',
    actual: actual.files,
    expected: { 'data/tracking/2031/hydration.csv': '"date", "time", "cups", "notes"\n2031-03-13, 9:15, 3\n' },
  })
})

test('track:ask: cancellation during date clarification writes nothing', async () => {
  const actual = await askScenario({
    answers: ['2 on that day', Symbol('cancel')],
    responses: [{ date: 'unclear', values: { cups: 2 } }],
  })
  assert({
    given: 'cancellation at the required date prompt',
    should: 'stop without confirming or writing a row',
    actual: [actual.files, actual.previews, actual.result?.recorded],
    expected: [{}, [], []],
  })
})
