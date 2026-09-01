import type { SkyConfig } from '#shared/config/types.ts'
import { assert, test } from '#test'
import { type ConfigRow, type ConfigSnapshot, describeConfig } from './mod.ts'

// The view is what is under test: a synthetic configuration, the file it
// came from, and the environment — never the machine's own.

const HOME = '/home/jane'
const PATH = `${HOME}/.sky/config.jsonc`

function configWith(overrides: Partial<SkyConfig> = {}): SkyConfig {
  return {
    version: 1,
    dir: `${HOME}/Sky`,
    userDataDir: `${HOME}/Sky-Data`,
    codeDir: `${HOME}/code/sky`,
    inputDir: `${HOME}/Desktop`,
    outputDir: `${HOME}/Desktop`,
    editor: 'code',
    categories: ['Professional', 'Personal'],
    commands: { dirs: [`${HOME}/sky-extras`], day: { start: ['day:sr:update', 'util:weather'], end: [] } },
    bins: {},
    slack: { workspace: 'https://atlas.slack.com' },
    web: {},
    voice: {},
    ai: {
      models: {
        strong: 'anthropic/claude-sonnet-5',
        fast: 'openai/gpt-4o-mini',
        transcription: 'openai/gpt-4o-transcribe',
      },
      profiles: {},
    },
    server: { port: 9999 },
    nbfs: { layout: 'YYYY/W##/MM-DD' },
    ...overrides,
  }
}

/** What `sky init` writes, roughly: paths as ~, the defaults left out. */
const FILE = {
  text: '{ /* synthetic */ }',
  parsed: {
    version: 1,
    dir: '~/Sky',
    userDataDir: '~/Sky-Data',
    editor: 'code',
    categories: ['Professional', 'Personal'],
    commands: { dirs: ['~/sky-extras'] },
    slack: { workspace: 'https://atlas.slack.com' },
  } as Partial<SkyConfig>,
}

function snapshotWith(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return { path: PATH, home: HOME, config: configWith(), file: FILE, env: {}, ...overrides }
}

function rowsByKey(snapshot: ConfigSnapshot): Map<string, ConfigRow> {
  const rows = describeConfig(snapshot).sections.flatMap((section) => section.rows)
  return new Map(rows.map((row) => [row.key, row]))
}

test({ name: 'settings view - every value, with where it came from' }, () => {
  const view = describeConfig(snapshotWith())
  const rows = rowsByKey(snapshotWith())

  assert({
    given: 'a file under the home directory',
    should: 'name it with ~ and say it exists',
    actual: [view.path, view.exists, view.version],
    expected: ['~/.sky/config.jsonc', true, 1],
  })
  assert({
    given: 'the sections',
    should: 'read in the file order, with nothing left for Other',
    actual: view.sections.map((section) => section.id),
    expected: ['notebook', 'commands', 'ai', 'web', 'slack', 'service'],
  })
  assert({
    given: 'a path the file sets',
    should: 'show it as ~/… and credit the file',
    actual: rows.get('dir'),
    expected: { key: 'dir', value: '~/Sky', source: 'file' },
  })
  assert({
    given: 'a path the file leaves out',
    should: 'show the default and say so',
    actual: rows.get('inputDir'),
    expected: { key: 'inputDir', value: '~/Desktop', source: 'default' },
  })
  assert({
    given: 'a list the file sets',
    should: 'keep every entry, home contracted',
    actual: rows.get('commands.dirs'),
    expected: { key: 'commands.dirs', value: ['~/sky-extras'], source: 'file' },
  })
  assert({
    given: 'a list the file leaves out',
    should: 'show the default list',
    actual: [rows.get('commands.day.start'), rows.get('commands.day.end')],
    expected: [
      { key: 'commands.day.start', value: ['day:sr:update', 'util:weather'], source: 'default' },
      { key: 'commands.day.end', value: [], source: 'default' },
    ],
  })
  assert({
    given: 'the model roles and the port, none in the file',
    should: 'show each default',
    actual: [rows.get('ai.models.strong')?.source, rows.get('server.port')],
    expected: ['default', { key: 'server.port', value: 9999, source: 'default' }],
  })
  assert({
    given: 'the workspace the file sets',
    should: 'credit the file',
    actual: rows.get('slack.workspace'),
    expected: { key: 'slack.workspace', value: 'https://atlas.slack.com', source: 'file' },
  })
  assert({
    given: 'the version',
    should: 'be the header, not a row',
    actual: rows.has('version'),
    expected: false,
  })
})

test({ name: 'settings view - a variable in the environment outranks the file' }, () => {
  const scratch = '/tmp/scratch-notebook'
  const rows = rowsByKey(snapshotWith({ config: configWith({ dir: scratch }), env: { SKY_DIR: scratch } }))

  assert({
    given: 'SKY_DIR set while the file also sets dir',
    should: 'show the variable’s value and name the variable',
    actual: rows.get('dir'),
    expected: { key: 'dir', value: scratch, source: 'env', via: 'SKY_DIR' },
  })
  assert({
    given: 'a key no variable covers',
    should: 'still credit the file',
    actual: rows.get('userDataDir')?.source,
    expected: 'file',
  })
})

test({ name: 'settings view - without the file, every value is a default' }, () => {
  const view = describeConfig(snapshotWith({ file: null, config: configWith({ editor: undefined, slack: {} }) }))
  const rows = new Map(view.sections.flatMap((section) => section.rows).map((row) => [row.key, row]))

  assert({
    given: 'no file',
    should: 'say so',
    actual: view.exists,
    expected: false,
  })
  assert({
    given: 'every row',
    should: 'be a default',
    actual: [...rows.values()].every((row) => row.source === 'default'),
    expected: true,
  })
  assert({
    given: 'keys nothing sets',
    should: 'still have a row, with no value',
    actual: [rows.get('editor'), rows.get('slack.workspace')],
    expected: [
      { key: 'editor', value: null, source: 'default' },
      { key: 'slack.workspace', value: null, source: 'default' },
    ],
  })
})

test({ name: 'settings view - groups list their entries; unknown keys keep a place' }, () => {
  const config = configWith({
    bins: { code: '/usr/local/bin/code' },
    ai: {
      models: {
        strong: 'anthropic/claude-sonnet-5',
        fast: 'openai/gpt-4o-mini',
        transcription: 'openai/gpt-4o-transcribe',
      },
      profiles: { local: { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434' } },
    },
    ...({ labs: { pond: 'on' } } as unknown as Partial<SkyConfig>),
  })
  const file = {
    text: FILE.text,
    parsed: { ...FILE.parsed, bins: { code: '/usr/local/bin/code' } } as Partial<SkyConfig>,
  }
  const view = describeConfig(snapshotWith({ config, file }))
  const section = (id: string) => view.sections.find((candidate) => candidate.id === id)

  assert({
    given: 'a bin',
    should: 'list under Commands after the fixed keys, credited to the file',
    actual: section('commands')?.rows.at(-1),
    expected: { key: 'bins.code', value: '/usr/local/bin/code', source: 'file' },
  })
  assert({
    given: 'a profile',
    should: 'list one row per field under AI',
    actual: section('ai')
      ?.rows.filter((row) => row.key.startsWith('ai.profiles.'))
      .map((row) => [row.key, row.value]),
    expected: [
      ['ai.profiles.local.provider', 'ollama'],
      ['ai.profiles.local.model', 'llama3'],
      ['ai.profiles.local.baseUrl', 'http://localhost:11434'],
    ],
  })
  assert({
    given: 'a key no section claims',
    should: 'land in Other rather than vanish',
    actual: section('other')?.rows,
    expected: [{ key: 'labs.pond', value: 'on', source: 'default' }],
  })
})
