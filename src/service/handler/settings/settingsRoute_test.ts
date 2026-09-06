import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import type { SkyConfig } from '#shared/config/types.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import {
  choiceLabel,
  type ConfigSnapshot,
  type ProfileInput,
  type SettableKey,
  type SettingsData,
  type SettingsRoutesOptions,
} from './mod.ts'

// The routes are what is under test: the host is scripted, never the machine.

const HOME = '/home/jane'

const CONFIG: SkyConfig = {
  version: 1,
  dir: `${HOME}/Sky`,
  userDataDir: `${HOME}/Sky-Data`,
  codeDir: `${HOME}/code/sky`,
  inputDir: `${HOME}/Desktop`,
  outputDir: `${HOME}/Desktop`,
  editor: 'code',
  categories: ['Professional', 'Personal'],
  commands: { dirs: [], day: { start: ['day:sr:update'], end: [] } },
  bins: {},
  slack: {},
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
}

const GROUPS = { male: ['ash', 'cedar'], female: ['marin', 'sage'] } as const

function hostWith(config: SkyConfig = CONFIG) {
  const writes: Array<[SettableKey, string]> = []
  const reveals: string[] = []
  const profileWrites: Array<[string, ProfileInput]> = []
  const profileDeletes: string[] = []
  const snapshot: ConfigSnapshot = {
    path: `${HOME}/.sky/config.jsonc`,
    home: HOME,
    config,
    file: { text: '{ "dir": "~/Sky" }', parsed: { dir: '~/Sky' } },
    env: {},
  }
  const host: SettingsRoutesOptions = {
    load: () => snapshot,
    voices: () => ({ current: 'ash', groups: GROUPS }),
    models: () => [
      { role: 'reasoning', label: 'Thinking', value: 'Claude Opus 5 · Anthropic', profile: 'default-opus-5' },
    ],
    builtinProfiles: () => [
      {
        name: 'default-opus-5',
        provider: 'anthropic',
        model: 'claude-opus-5',
        options: { effort: 'xhigh' },
      },
    ],
    providers: () => ['anthropic', 'openai', 'ollama', 'lm-studio'],
    writeProfile: (name, profile) => {
      profileWrites.push([name, profile])
      return Promise.resolve()
    },
    deleteProfile: (name) => {
      profileDeletes.push(name)
      return Promise.resolve()
    },
    editors: () => Promise.resolve(['code', 'zed']),
    memoryNotes: () => Promise.resolve(7),
    about: () => Promise.resolve({ version: 'abc1234', date: '2026-08-30' }),
    write: (key, value) => {
      writes.push([key, value])
      return Promise.resolve()
    },
    reveal: (target) => {
      reveals.push(target)
      return Promise.resolve()
    },
  }
  return { host, writes, reveals, profileWrites, profileDeletes }
}

async function appWith(settings?: SettingsRoutesOptions) {
  const tmp = await makeTempDir({ prefix: 'sky-settings-route-' })
  return createTestHttpApp([tmp], { settings })
}

type App = Awaited<ReturnType<typeof appWith>>

function post(app: App, url: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

test({ name: 'settings route - one payload carries every pane' }, async () => {
  const { host } = hostWith()
  const app = await appWith(host)

  const response = await app.request('http://localhost/settings/_api/settings')
  const data = (await response.json()) as SettingsData

  assert({
    given: 'a config with no web/voice keys',
    should: 'answer the defaults and the host values',
    actual: [response.status, data.theme, data.textSize, data.voice.current, data.memoryNotes],
    expected: [200, 'system', 'default', 'ash', 7],
  })
  assert({
    given: 'the notebook block',
    should: 'contract home and carry the editors',
    actual: data.notebook,
    expected: {
      dir: '~/Sky',
      userDataDir: '~/Sky-Data',
      inputDir: '~/Desktop',
      outputDir: '~/Desktop',
      editor: 'code',
      editors: ['code', 'zed'],
    },
  })
  assert({
    given: 'the rest',
    should: 'ride along: models, about, and the advanced view',
    actual: [data.models, data.about, data.advanced.path, data.advanced.exists],
    expected: [
      [{ role: 'reasoning', label: 'Thinking', value: 'Claude Opus 5 · Anthropic', profile: 'default-opus-5' }],
      { version: 'abc1234', date: '2026-08-30' },
      '~/.sky/config.jsonc',
      true,
    ],
  })

  const configured = hostWith({ ...CONFIG, web: { theme: 'dark', textSize: 'large' }, voice: { voice: 'marin' } })
  const app2 = await appWith(configured.host)
  const data2 = (await (await app2.request('http://localhost/settings/_api/settings')).json()) as SettingsData
  assert({
    given: 'a config that sets web.theme and web.textSize',
    should: 'answer them',
    actual: [data2.theme, data2.textSize],
    expected: ['dark', 'large'],
  })
})

test({ name: 'settings route - set writes only known keys with valid values' }, async () => {
  const { host, writes } = hostWith()
  const app = await appWith(host)

  const good = await post(app, '/settings/_api/set', { key: 'web.theme', value: 'dark' })
  const voice = await post(app, '/settings/_api/set', { key: 'voice.voice', value: 'marin' })
  assert({
    given: 'valid writes',
    should: 'answer ok and reach the host in order',
    actual: [good.status, voice.status, writes],
    expected: [
      200,
      200,
      [
        ['web.theme', 'dark'],
        ['voice.voice', 'marin'],
      ],
    ],
  })

  const badTheme = await post(app, '/settings/_api/set', { key: 'web.theme', value: 'purple' })
  const badVoice = await post(app, '/settings/_api/set', { key: 'voice.voice', value: 'hal9000' })
  const badKey = await post(app, '/settings/_api/set', { key: 'server.port', value: '80' })
  const badEditor = await post(app, '/settings/_api/set', { key: 'editor', value: 'vim' })
  assert({
    given: 'a bad value, a bad voice, an unsettable key, an unknown editor',
    should: 'refuse each with 400 and write nothing more',
    actual: [badTheme.status, badVoice.status, badKey.status, badEditor.status, writes.length],
    expected: [400, 400, 400, 400, 2],
  })
})

test({ name: 'settings route - reveal opens only known targets' }, async () => {
  const { host, reveals } = hostWith()
  const app = await appWith(host)

  const ok = await post(app, '/settings/_api/reveal', { target: 'config' })
  const bad = await post(app, '/settings/_api/reveal', { target: '/etc/passwd' })
  assert({
    given: 'a known and an unknown target',
    should: 'open one, refuse the other',
    actual: [ok.status, bad.status, reveals],
    expected: [200, 400, ['config']],
  })
})

test({ name: 'settings route - the page is the shell; without a host the api is not served' }, async () => {
  const { host } = hostWith()
  const app = await appWith(host)
  const page = await app.request('http://localhost/settings')
  const section = await app.request('http://localhost/settings/voice')
  assert({
    given: '/settings and /settings/voice',
    should: 'serve the client shell for both',
    actual: [page.status, (await page.text()).includes('id="root"'), section.status],
    expected: [200, true, 200],
  })

  const bare = await appWith()
  const api = await bare.request('http://localhost/settings/_api/settings')
  assert({
    given: 'no settings host',
    should: '404 the api',
    actual: api.status,
    expected: 404,
  })
})

test({ name: 'settings route - configurations list yours first, roles attached' }, async () => {
  const withOwn = hostWith({
    ...CONFIG,
    ai: {
      ...CONFIG.ai,
      profiles: {
        scout: { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434' },
        'default-opus-5': { provider: 'openai', model: 'gpt-5.5' },
      },
    },
  })
  const app = await appWith(withOwn.host)
  const data = (await (await app.request('http://localhost/settings/_api/settings')).json()) as SettingsData

  assert({
    given: 'a config with two profiles of its own, one shadowing a built-in',
    should: 'list yours first — the shadow marked — then the built-in with its roles',
    actual: data.profiles,
    expected: [
      {
        name: 'scout',
        builtin: false,
        provider: 'ollama',
        model: 'llama3',
        baseUrl: 'http://localhost:11434',
        roles: [],
      },
      {
        name: 'default-opus-5',
        builtin: false,
        provider: 'openai',
        model: 'gpt-5.5',
        roles: ['Thinking'],
        overrides: true,
      },
      {
        name: 'default-opus-5',
        builtin: true,
        provider: 'anthropic',
        model: 'claude-opus-5',
        options: { effort: 'xhigh' },
        roles: ['Thinking'],
      },
    ],
  })
  assert({
    given: 'the payload',
    should: 'carry the providers a form may offer',
    actual: data.providers,
    expected: ['anthropic', 'openai', 'ollama', 'lm-studio'],
  })
})

test({ name: 'settings route - defining a configuration validates, then writes' }, async () => {
  const { host, profileWrites } = hostWith()
  const app = await appWith(host)

  const good = await post(app, '/settings/_api/profile', {
    name: 'scout',
    provider: 'ollama',
    model: ' llama3 ',
    baseUrl: 'http://localhost:11434',
    options: { temperature: 0.2 },
  })
  assert({
    given: 'a valid definition',
    should: 'write it, model trimmed',
    actual: [good.status, profileWrites],
    expected: [
      200,
      [
        [
          'scout',
          { provider: 'ollama', model: 'llama3', baseUrl: 'http://localhost:11434', options: { temperature: 0.2 } },
        ],
      ],
    ],
  })

  const badName = await post(app, '/settings/_api/profile', { name: 'my profile', provider: 'ollama', model: 'x' })
  const badProvider = await post(app, '/settings/_api/profile', { name: 'a', provider: 'aws', model: 'x' })
  const noModel = await post(app, '/settings/_api/profile', { name: 'a', provider: 'ollama', model: '  ' })
  const badOptions = await post(app, '/settings/_api/profile', {
    name: 'a',
    provider: 'ollama',
    model: 'x',
    options: [1],
  })
  assert({
    given: 'a spaced name, an unknown provider, a blank model, options as an array',
    should: 'refuse each with 400 and write nothing more',
    actual: [badName.status, badProvider.status, noModel.status, badOptions.status, profileWrites.length],
    expected: [400, 400, 400, 400, 1],
  })
})

test({ name: 'settings route - deleting removes yours and refuses the built-ins' }, async () => {
  const withOwn = hostWith({
    ...CONFIG,
    ai: { ...CONFIG.ai, profiles: { scout: { provider: 'ollama', model: 'llama3' } } },
  })
  const app = await appWith(withOwn.host)

  const del = (name: string) => app.request(`http://localhost/settings/_api/profile/${name}`, { method: 'DELETE' })
  const gone = await del('scout')
  const builtin = await del('default-opus-5')
  const unknown = await del('nope')
  assert({
    given: 'a delete of yours, a built-in, and an unknown name',
    should: 'remove the first, refuse the others',
    actual: [gone.status, builtin.status, unknown.status, withOwn.profileDeletes],
    expected: [200, 400, 404, ['scout']],
  })
})

test({ name: 'settings route - connections ride along when the host has a keychain' }, async () => {
  const { host } = hostWith()
  const bare = await appWith(host)
  const missing = await bare.request('http://localhost/settings/_api/connections')

  const secrets = new TestSecretsProvider({ 'notion/main': createSecret('ntn-secret') })
  const app = await appWith({
    ...host,
    connections: {
      secrets,
      providers: () => [],
      google: { connect: () => Promise.resolve(null), connection: () => null },
      slack: {
        status: () => Promise.resolve({ installed: false }),
        reconnect: () => Promise.resolve({ installed: false }),
      },
    },
  })
  const response = await app.request('http://localhost/settings/_api/connections')
  const text = await response.text()
  assert({
    given: 'a settings host without, then with, a connections host',
    should: '404 the first and answer the second with names only',
    actual: [
      missing.status,
      response.status,
      (JSON.parse(text) as { secrets: unknown }).secrets,
      text.includes('ntn-secret'),
    ],
    expected: [404, 200, [{ category: 'notion', name: 'main', type: 'secret', label: 'notion', sub: 'Secret' }], false],
  })
})

test({ name: 'choiceLabel - two profiles on one model carry their effort; a lone one keeps the bare name' }, () => {
  const all = {
    'default-fable-5.1': {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
    },
    'default-fable-5.1-high': {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      options: { effort: 'high', thinking: { type: 'adaptive' } },
    },
    'default-opus-5': { provider: 'anthropic', model: 'claude-opus-5', options: { effort: 'xhigh' } },
    'default-gpt-5.5': { provider: 'openai', model: 'gpt-5.5', options: { reasoningEffort: 'xhigh' } },
    mine: { provider: 'openai', model: 'gpt-5.5' },
  } as unknown as Parameters<typeof choiceLabel>[1]
  assert({
    given: 'a catalog where Fable 5.1 appears twice, once at each effort, and Opus 5 once',
    should: 'tell the twins apart by effort and leave the lone model bare',
    actual: Object.keys(all).map((name) => choiceLabel(name, all)),
    expected: [
      'Claude Fable 5.1 · xhigh',
      'Claude Fable 5.1 · high',
      'Claude Opus 5',
      'GPT 5.5 · xhigh',
      'GPT 5.5 · mine',
    ],
  })
})
