import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import Automation from '#shared/models/Automation/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { automationCommands, configureAutomations, setupFromCharter, type AutomationCommand } from './configure.ts'

const flags: CommandEntry['flags'] = [
  { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day to recap' },
  { name: 'no-editor', kind: 'flag', type: 'bool', description: 'Leave the editor closed' },
]
const commands: AutomationCommand[] = ['recap:journal', 'recap:notes'].map((name) => ({
  name,
  description: 'Recap saved activity.',
  source: 'local',
  flags,
}))
const options = { commands, existingNames: new Set(['recap-journal']), today: new PlainDate('2025-03-15') }

test('automation catalog matches execution precedence and omits file paths', () => {
  const entry = (name: string, description: string): CommandEntry => ({
    name,
    description,
    flags,
    file: '/mock/commands/recap.ts',
    aiChatTool: false,
  })
  const manifest: CommandsManifest = {
    version: 2,
    commands: {
      core: [entry('recap:journal', 'Core journal'), entry('day:start', 'Start the day')],
      global: [entry('recap:journal', 'Global journal')],
      local: [entry('recap:journal', 'Local journal'), entry('recap:notes', 'Local notes')],
    },
  }
  const catalog = automationCommands(manifest)
  assert({
    given: 'a local command shadowing a global and core command',
    should: 'suggest the exact implementation that runs, without paths',
    actual: [
      catalog.map(({ name, description, source }) => ({ name, description, source })),
      catalog.some((command) => 'file' in command),
    ],
    expected: [
      [
        { name: 'day:start', description: 'Start the day', source: 'core' },
        { name: 'recap:journal', description: 'Local journal', source: 'local' },
        { name: 'recap:notes', description: 'Local notes', source: 'local' },
      ],
      false,
    ],
  })
})

test('morning recap proposals keep relative days, shared conditions and separate names', () => {
  const drafts = configureAutomations(
    {
      commands: commands.map((command) => ({ run: command.name, args: { day: 'yesterday', 'no-editor': true } })),
      at: ['EVERY-MON 07:30', 'EVERY-THU 07:30'],
      tz: 'Europe/Paris',
      until: '2025-12-31',
    },
    options,
  )
  assert({
    given: 'two recap commands and an existing name',
    should: 'produce two collision-free charters with the selected conditions',
    actual: drafts.map((draft) => {
      const automation = Automation.fromMarkdown(draft.contents, draft.name)
      return {
        name: draft.name,
        run: automation.run,
        args: automation.args,
        until: automation.until?.ymd,
        trigger: draft.trigger,
        frame: draft.frame,
      }
    }),
    expected: [
      {
        name: 'recap-journal-2',
        run: 'recap:journal',
        args: { day: 'yesterday', noEditor: true },
        until: '2025-12-31',
        trigger: 'EVERY-MON 07:30, EVERY-THU 07:30',
        frame: 'Europe/Paris',
      },
      {
        name: 'recap-notes',
        run: 'recap:notes',
        args: { day: 'yesterday', noEditor: true },
        until: '2025-12-31',
        trigger: 'EVERY-MON 07:30, EVERY-THU 07:30',
        frame: 'Europe/Paris',
      },
    ],
  })
})

test('automation editing preserves status, metadata, comments and an unchanged brief', () => {
  const contents =
    '---\n# Keep this note\nrun: recap:journal\nat: EVERY-WEEKDAY 08:00\ntz: Europe/Paris\nstatus: paused\nkind: system\ncreated: 2025-01-01\ntags: [journal]\nargs:\n  day: yesterday\n  noEditor: true\n---\n\nKeep my recap.\n\n'
  const setup = setupFromCharter('recap-journal', contents)
  delete setup.at
  delete setup.tz
  setup.every = '2h'
  const [draft] = configureAutomations(setup, { ...options, current: { name: 'recap-journal', contents } })
  const result = Automation.fromMarkdown(draft!.contents, draft!.name)
  assert({
    given: 'an existing paused system charter changing to an interval',
    should: 'change only its requested settings and updated date',
    actual: [
      result.status,
      result.kind,
      result.args,
      draft!.trigger,
      draft!.name,
      draft!.contents.includes('# Keep this note'),
      draft!.contents.includes('created: 2025-01-01'),
      draft!.contents.includes('updated: 2025-03-15'),
      Document.fromMarkdown(draft!.contents).yaml.tags,
      draft!.contents.endsWith('---\n\nKeep my recap.\n\n'),
      draft!.contents.includes('tz:'),
    ],
    expected: [
      'paused',
      'system',
      { day: 'yesterday', noEditor: true },
      'every 2h',
      'recap-journal',
      true,
      true,
      true,
      ['journal'],
      true,
      false,
    ],
  })
})

test('automation proposals reject unsupported settings and invalid schedules', () => {
  const base = { commands: [{ run: 'recap:notes', args: {} }], at: ['07:00'] }
  const rejected = [
    { ...base, commands: [{ run: 'not:a:command', args: {} }] },
    { ...base, commands: [{ run: 'recap:notes', args: { invented: true } }] },
    { ...base, commands: [{ run: 'recap:notes', args: { noEditor: 'true' } }] },
    { ...base, commands: [{ run: 'recap:notes', name: '../escape', args: {} }] },
    { ...base, at: ['EVERY-MONDAY 07:00'] },
    { ...base, every: '2h' },
    { ...base, tz: 'Imaginary/Place' },
    { ...base, until: 'not-a-date' },
    { ...base, revise: 'missing' },
  ].map((setup) => {
    try {
      configureAutomations(setup, options)
      return false
    } catch {
      return true
    }
  })
  assert({
    given: 'unsupported commands, arguments, names and conditions',
    should: 'reject every invalid proposal before any file can be saved',
    actual: rejected,
    expected: Array(9).fill(true),
  })
})
