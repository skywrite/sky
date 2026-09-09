import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import Automation from '#shared/models/Automation/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { automationCommands, configureAutomation, setupFromCharter, type AutomationCommand } from './configure.ts'

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
const options = {
  commands,
  existingNames: new Set(['recap-journal', 'morning-recaps']),
  today: new PlainDate('2025-03-15'),
}

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

test('several recap commands produce one automation with a shared schedule', () => {
  const draft = configureAutomation(
    {
      commands: commands.map((command) => ({ run: command.name, args: { day: 'yesterday', 'no-editor': true } })),
      at: ['EVERY-MON 07:30', 'EVERY-THU 07:30'],
      tz: 'Europe/Paris',
      until: '2025-12-31',
    },
    options,
  )
  const automation = Automation.fromMarkdown(draft.contents, draft.name)
  assert({
    given: 'several selected commands and an existing morning-recaps automation',
    should: 'create one collision-free charter containing every command and one schedule',
    actual: [draft.name, automation.commands, draft.trigger, draft.frame, draft.until],
    expected: [
      'morning-recaps-2',
      [
        { run: 'recap:journal', args: { day: 'yesterday', noEditor: true } },
        { run: 'recap:notes', args: { day: 'yesterday', noEditor: true } },
      ],
      'EVERY-MON 07:30, EVERY-THU 07:30',
      'Europe/Paris',
      '2025-12-31',
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
  const draft = configureAutomation(setup, { ...options, current: { name: 'recap-journal', contents } })
  const result = Automation.fromMarkdown(draft!.contents, draft!.name)
  assert({
    given: 'an existing paused system charter changing to an interval',
    should: 'change only its requested settings and updated date',
    actual: [
      result.status,
      result.kind,
      result.commands[0]!.args,
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
    { ...base, name: '../escape' },
    { ...base, at: ['EVERY-MONDAY 07:00'] },
    { ...base, every: '2h' },
    { ...base, tz: 'Imaginary/Place' },
    { ...base, until: 'not-a-date' },
    { ...base, revise: 'missing' },
  ].map((setup) => {
    try {
      configureAutomation(setup, options)
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

test('automation editing can add and remove commands without changing its identity', () => {
  const contents =
    '---\n# Keep the original note\nrun: recap:journal\nargs:\n  day: yesterday\nat: 07:00\nstatus: paused\ncreated: 2025-01-01\n---\n\nKeep the recaps.\n'
  const setup = setupFromCharter('recap-journal', contents)
  setup.commands.push({ run: 'recap:notes', args: { day: 'yesterday' } })
  const group = configureAutomation(setup, { ...options, current: { name: 'recap-journal', contents } })
  const singleSetup = setupFromCharter(group.name, group.contents)
  singleSetup.commands = singleSetup.commands.slice(0, 1)
  const single = configureAutomation(singleSetup, {
    ...options,
    current: { name: group.name, contents: group.contents },
  })
  assert({
    given: 'adding a command to a legacy file and then removing it',
    should: 'preserve the same paused charter, arguments and comments in both forms',
    actual: [group, single].map((draft) => {
      const automation = Automation.fromMarkdown(draft.contents, draft.name)
      return [
        draft.name,
        automation.commands.length,
        automation.commands[0]!.args,
        automation.status,
        draft.contents.includes('# Keep the original note'),
      ]
    }),
    expected: [
      ['recap-journal', 2, { day: 'yesterday' }, 'paused', true],
      ['recap-journal', 1, { day: 'yesterday' }, 'paused', true],
    ],
  })
})

test('automation editing still replaces a single command and adds new arguments', () => {
  const contents = '---\n# Keep this context\nrun: recap:journal\nat: 07:00\nstatus: paused\n---\n\nKeep the recap.\n'
  const setup = setupFromCharter('recap-journal', contents)
  setup.commands = [{ run: 'recap:notes', args: { day: 'yesterday', noEditor: true } }]
  const draft = configureAutomation(setup, { ...options, current: { name: setup.revise!, contents } })
  const saved = Automation.fromMarkdown(draft.contents, draft.name)
  assert({
    given: 'replacing the only command and setting its arguments',
    should: 'save the replacement under the same paused charter with its original context',
    actual: [saved.commands, saved.status, draft.contents.includes('# Keep this context')],
    expected: [[{ run: 'recap:notes', args: { day: 'yesterday', noEditor: true } }], 'paused', true],
  })
})
