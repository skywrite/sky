/**
 * Settings — the app's preferences as a page, one section at a time.
 *
 * The page is mainstream-shaped: Appearance, Voice, AI, Notebook,
 * Advanced, About. What a person changes here is written back to
 * ~/.sky/config.jsonc (comments preserved); what is shown is read fresh
 * on every request. Connections — accounts and API keys — is deferred
 * until the keychain rung.
 *
 * Advanced keeps the earlier configuration view: every key with its
 * value and where it came from — the file, a default, or an environment
 * override. Secrets never pass through here.
 */

import { Hono } from 'hono'
import type { ModelProfile } from '#shared/ai/models.ts'
import { ENV_OVERRIDES } from '#shared/config/loader.ts'
import type { SkyConfig } from '#shared/config/types.ts'

// ── The configuration view (the Advanced pane) ──────────────────────

/** What the view is built from — production reads the real file, tests hand in their own. */
export interface ConfigSnapshot {
  /** Where the file lives */
  path: string
  /** The home directory, so paths under it read as ~/… */
  home: string
  /** The configuration as loaded: defaults, the file, and the environment applied */
  config: SkyConfig
  /** The file as written; null when there is none */
  file: { text: string; parsed: Partial<SkyConfig> } | null
  /** The environment the overrides are read from */
  env: NodeJS.ProcessEnv
}

export type ConfigValue = string | number | boolean | string[] | null

export interface ConfigRow {
  /** The key as it reads in the file, dotted: `ai.models.strong` */
  key: string
  /** null when nothing sets the key */
  value: ConfigValue
  /** `file` when the file sets the key, `env` when a variable outranks it, else `default` */
  source: 'file' | 'default' | 'env'
  /** The variable, when the source is the environment */
  via?: string
}

export interface ConfigSection {
  id: string
  title: string
  rows: ConfigRow[]
}

export interface ConfigView {
  /** Where the file lives, home written as ~ */
  path: string
  /** Without the file every value is a default */
  exists: boolean
  version: number
  sections: ConfigSection[]
}

/**
 * The view's sections, in reading order. `keys` are shown even when nothing
 * sets them; `groups` are prefixes whose entries — a bin, a profile — are
 * listed as they come. Anything the file carries beyond these lands in Other.
 */
const SECTIONS: ReadonlyArray<{ id: string; title: string; keys: string[]; groups?: string[] }> = [
  {
    id: 'notebook',
    title: 'Notebook',
    keys: ['dir', 'userDataDir', 'inputDir', 'outputDir', 'codeDir', 'editor', 'categories', 'nbfs.layout'],
  },
  {
    id: 'commands',
    title: 'Commands',
    keys: ['commands.dirs', 'commands.day.start', 'commands.day.end'],
    groups: ['bins'],
  },
  {
    id: 'ai',
    title: 'AI',
    keys: ['ai.models.strong', 'ai.models.fast', 'ai.models.transcription'],
    groups: ['ai.profiles'],
  },
  { id: 'web', title: 'Web', keys: ['web.theme', 'web.textSize', 'voice.voice'] },
  { id: 'slack', title: 'Slack', keys: ['slack.workspace'] },
  { id: 'service', title: 'Service', keys: ['server.port'] },
]

interface Leaf {
  path: string[]
  value: ConfigValue
}

/** Every scalar and list in the configuration, by its path. Empty objects contribute nothing. */
function leavesOf(value: unknown, path: string[], out: Leaf[]): void {
  if (value === undefined) return
  if (value === null || typeof value !== 'object') {
    out.push({ path, value: value as string | number | boolean | null })
    return
  }
  if (Array.isArray(value)) {
    out.push({ path, value: value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))) })
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) leavesOf(child, [...path, key], out)
}

function at(value: unknown, path: string[]): unknown {
  let cursor = value
  for (const part of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function contractHome(value: string, home: string): string {
  if (!home) return value
  if (value === home) return '~'
  return value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value
}

function withHome(value: ConfigValue, home: string): ConfigValue {
  if (typeof value === 'string') return contractHome(value, home)
  if (Array.isArray(value)) return value.map((item) => contractHome(item, home))
  return value
}

function sourceOf(path: string[], snapshot: ConfigSnapshot): Pick<ConfigRow, 'source' | 'via'> {
  const key = path.join('.')
  const override = ENV_OVERRIDES.find((candidate) => candidate.key === key)
  if (override && snapshot.env[override.env]) return { source: 'env', via: override.env }
  if (snapshot.file && at(snapshot.file.parsed, path) !== undefined) return { source: 'file' }
  return { source: 'default' }
}

/** The configuration as the Advanced pane reads it: sections of rows, each row with its provenance. */
export function describeConfig(snapshot: ConfigSnapshot): ConfigView {
  const leaves: Leaf[] = []
  leavesOf(snapshot.config, [], leaves)
  const unplaced = new Map(leaves.map((leaf) => [leaf.path.join('.'), leaf]))
  unplaced.delete('version')

  const row = (key: string, leaf: Leaf | undefined): ConfigRow => ({
    key,
    value: leaf ? withHome(leaf.value, snapshot.home) : null,
    ...sourceOf(key.split('.'), snapshot),
  })

  const sections: ConfigSection[] = []
  for (const spec of SECTIONS) {
    const rows: ConfigRow[] = []
    for (const key of spec.keys) {
      rows.push(row(key, unplaced.get(key)))
      unplaced.delete(key)
    }
    for (const group of spec.groups ?? []) {
      for (const [key, leaf] of unplaced) {
        if (key !== group && !key.startsWith(`${group}.`)) continue
        rows.push(row(key, leaf))
        unplaced.delete(key)
      }
    }
    sections.push({ id: spec.id, title: spec.title, rows })
  }
  if (unplaced.size > 0) {
    sections.push({ id: 'other', title: 'Other', rows: [...unplaced].map(([key, leaf]) => row(key, leaf)) })
  }

  return {
    path: contractHome(snapshot.path, snapshot.home),
    exists: snapshot.file !== null,
    version: snapshot.config.version,
    sections,
  }
}

// ── The settings page's data ────────────────────────────────────────

export type Theme = 'system' | 'light' | 'dark'
export type TextSize = 'default' | 'large'
export type RevealTarget = 'dir' | 'userDataDir' | 'config'

export const THEMES: readonly Theme[] = ['system', 'light', 'dark']
export const TEXT_SIZES: readonly TextSize[] = ['default', 'large']
export const REVEAL_TARGETS: readonly RevealTarget[] = ['dir', 'userDataDir', 'config']

/** One model role as the AI pane shows it. */
export interface ModelRow {
  role: string
  /** The role in plain words: Thinking, Quick, … */
  label: string
  /** `Claude Opus 5 · Anthropic` */
  value: string
  /** The configuration the role points at, by name */
  profile: string
}

/** One model configuration as the AI pane lists it. */
export interface ProfileRow {
  name: string
  /** Ships with Sky, lives in code, read-only here */
  builtin: boolean
  provider: string
  model: string
  baseUrl?: string
  /** The tuned knobs, as written */
  options?: Record<string, unknown>
  /** The roles pointing at this configuration, in plain words */
  roles: string[]
  /** A configuration of yours that takes over a built-in name */
  overrides?: boolean
}

/** What defining a configuration takes. */
export interface ProfileInput {
  provider: string
  model: string
  baseUrl?: string
  options?: Record<string, unknown>
}

/** Everything the page shows, in one payload. */
export interface SettingsData {
  theme: Theme
  textSize: TextSize
  voice: { current: string; groups: Record<'male' | 'female', readonly string[]> }
  models: ModelRow[]
  /** Every model configuration: yours first, then the built-ins */
  profiles: ProfileRow[]
  /** The providers a configuration may name */
  providers: string[]
  /** Notes under the notebook's ai/memory/ */
  memoryNotes: number
  notebook: {
    dir: string
    userDataDir: string
    inputDir: string
    outputDir: string
    editor: string | null
    /** Editor commands present on this machine, the configured one included */
    editors: string[]
  }
  about: { version: string | null; date: string | null }
  advanced: ConfigView
}

/** The host behind the routes — production reads the machine, tests script it. */
export interface SettingsHost {
  /** The file and the configuration read from it, fresh for each request */
  load: () => ConfigSnapshot
  /** The voices Talk offers and the one sessions use now */
  voices: () => SettingsData['voice']
  /** The model roles as the AI pane shows them — read-only rows */
  models: () => ModelRow[]
  /** The built-in configurations as shipped */
  builtinProfiles: () => Array<Pick<ProfileRow, 'name' | 'provider' | 'model' | 'baseUrl' | 'options'>>
  /** The providers a configuration may name */
  providers: () => string[]
  /** Writes ai.profiles.<name> into the file */
  writeProfile: (name: string, profile: ProfileInput) => Promise<void>
  /** Removes ai.profiles.<name> from the file */
  deleteProfile: (name: string) => Promise<void>
  /** Editor commands present on this machine */
  editors: () => Promise<string[]>
  /** How many notes ai/memory holds */
  memoryNotes: () => Promise<number>
  /** The build the service runs; nulls when unknowable */
  about: () => Promise<SettingsData['about']>
  /** One settable key into the config file */
  write: (key: SettableKey, value: string) => Promise<void>
  /** Opens a folder, or the config file, on this machine */
  reveal: (target: RevealTarget) => Promise<void>
}

export type SettingsRoutesOptions = SettingsHost

/** The keys the page may write, and where each lives in the file. */
export const SETTABLE_KEYS = {
  'web.theme': ['web', 'theme'],
  'web.textSize': ['web', 'textSize'],
  'voice.voice': ['voice', 'voice'],
  editor: ['editor'],
} as const

export type SettableKey = keyof typeof SETTABLE_KEYS

/** The valid values for one settable key, against the live host. null = fine. */
async function refuse(host: SettingsHost, key: SettableKey, value: string): Promise<string | null> {
  switch (key) {
    case 'web.theme':
      return (THEMES as readonly string[]).includes(value) ? null : `theme must be one of ${THEMES.join(', ')}`
    case 'web.textSize':
      return (TEXT_SIZES as readonly string[]).includes(value)
        ? null
        : `text size must be one of ${TEXT_SIZES.join(', ')}`
    case 'voice.voice': {
      const { groups } = host.voices()
      return [...groups.male, ...groups.female].includes(value) ? null : `no such voice: ${value}`
    }
    case 'editor': {
      const editors = await host.editors()
      return editors.includes(value) ? null : `no such editor on this machine: ${value}`
    }
  }
}

async function settingsData(host: SettingsHost): Promise<SettingsData> {
  const snapshot = host.load()
  const { config, home } = snapshot
  const [editors, memoryNotes, about] = await Promise.all([host.editors(), host.memoryNotes(), host.about()])
  return {
    theme: config.web.theme ?? 'system',
    textSize: config.web.textSize ?? 'default',
    voice: host.voices(),
    models: host.models(),
    profiles: profileRows(host, config),
    providers: host.providers(),
    memoryNotes,
    notebook: {
      dir: contractHome(config.dir, home),
      userDataDir: contractHome(config.userDataDir, home),
      inputDir: contractHome(config.inputDir, home),
      outputDir: contractHome(config.outputDir, home),
      editor: config.editor ?? null,
      editors,
    },
    about,
    advanced: describeConfig(snapshot),
  }
}

export function createSettingsRoutes(options: SettingsRoutesOptions): Hono {
  const app = new Hono()

  // Everything the page shows, read afresh per request.
  app.get('/settings', async (c) => {
    try {
      return c.json(await settingsData(options))
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // One preference into the file. The client applies the change itself.
  app.post('/set', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null
    const key = typeof body?.key === 'string' ? body.key : ''
    if (!(key in SETTABLE_KEYS)) return c.json({ message: `not a settable key: ${key || '(missing)'}` }, 400)
    if (typeof body?.value !== 'string') return c.json({ message: 'expected { key, value }' }, 400)
    const refusal = await refuse(options, key as SettableKey, body.value)
    if (refusal) return c.json({ message: refusal }, 400)
    try {
      await options.write(key as SettableKey, body.value)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // A folder — or the file — opened on the machine the service runs on.
  app.post('/reveal', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { target?: unknown } | null
    const target = typeof body?.target === 'string' ? body.target : ''
    if (!(REVEAL_TARGETS as readonly string[]).includes(target)) {
      return c.json({ message: `not a reveal target: ${target || '(missing)'}` }, 400)
    }
    try {
      await options.reveal(target as RevealTarget)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Define one model configuration — ai.profiles.<name> in the file.
  app.post('/profile', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: unknown
      provider?: unknown
      model?: unknown
      baseUrl?: unknown
      options?: unknown
    } | null
    const name = typeof body?.name === 'string' ? body.name : ''
    if (!PROFILE_NAME.test(name)) {
      return c.json({ message: 'a name is letters, digits, dots, dashes — no spaces' }, 400)
    }
    const providers = options.providers()
    if (typeof body?.provider !== 'string' || !providers.includes(body.provider)) {
      return c.json({ message: `provider must be one of ${providers.join(', ')}` }, 400)
    }
    if (typeof body?.model !== 'string' || !body.model.trim()) {
      return c.json({ message: 'a configuration needs a model id' }, 400)
    }
    if (body.baseUrl !== undefined && (typeof body.baseUrl !== 'string' || !body.baseUrl.trim())) {
      return c.json({ message: 'baseUrl must be a URL, or left out' }, 400)
    }
    if (
      body.options !== undefined &&
      (typeof body.options !== 'object' || body.options === null || Array.isArray(body.options))
    ) {
      return c.json({ message: 'options must be a JSON object, or left out' }, 400)
    }
    const profile: ProfileInput = {
      provider: body.provider,
      model: body.model.trim(),
      ...(body.baseUrl ? { baseUrl: body.baseUrl.trim() } : {}),
      ...(body.options ? { options: body.options as Record<string, unknown> } : {}),
    }
    try {
      await options.writeProfile(name, profile)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Remove one of yours. The built-ins live in code and stay.
  app.delete('/profile/:name', async (c) => {
    const name = c.req.param('name')
    if (options.builtinProfiles().some((profile) => profile.name === name)) {
      const yours = options.load().config.ai.profiles ?? {}
      if (!(name in yours)) return c.json({ message: 'that configuration is built in — it lives in code' }, 400)
    } else if (!(options.load().config.ai.profiles ?? {})[name]) {
      return c.json({ message: `no such configuration: ${name}` }, 404)
    }
    try {
      await options.deleteProfile(name)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // The Advanced pane's configuration view — also the whole page's first rung.
  app.get('/config', (c) => {
    try {
      return c.json(describeConfig(options.load()))
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}

/** Letters, digits, dots, dashes, underscores — a config key that needs no quoting games. */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Yours first, then the built-ins; each row carries the roles pointing at it. */
function profileRows(host: SettingsHost, config: SkyConfig): ProfileRow[] {
  const rolesBy = new Map<string, string[]>()
  for (const row of host.models()) {
    rolesBy.set(row.profile, [...(rolesBy.get(row.profile) ?? []), row.label])
  }
  const builtins = host.builtinProfiles()
  const builtinNames = new Set(builtins.map((profile) => profile.name))
  const yours = Object.entries(config.ai.profiles ?? {}).map(
    ([name, profile]): ProfileRow => ({
      name,
      builtin: false,
      provider: profile.provider,
      model: profile.model,
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
      ...(profile.options ? { options: profile.options } : {}),
      roles: rolesBy.get(name) ?? [],
      ...(builtinNames.has(name) ? { overrides: true } : {}),
    }),
  )
  const shipped = builtins.map(
    (profile): ProfileRow => ({ ...profile, builtin: true, roles: rolesBy.get(profile.name) ?? [] }),
  )
  return [...yours, ...shipped]
}

// ── The AI pane's rows ──────────────────────────────────────────────────

/** claude-opus-5 → Claude Opus 5 · claude-haiku-4-5 → Claude Haiku 4.5 · gpt-5.5 → GPT 5.5 */
export function prettyModel(id: string): string {
  const joined = id
    .split(/[-/]/)
    .map((part) => {
      if (/^gpt/i.test(part)) return part.toUpperCase()
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
  return joined.replace(/ (\d+) (\d+)$/, ' $1.$2')
}

/**
 * A profile's line where models are listed: the model's name, and when another profile
 * runs the same model, the effort that tells them apart — `Claude Fable 5.1 · xhigh`
 * beside `Claude Fable 5.1 · high`. A model only one profile runs keeps its bare name.
 */
export function choiceLabel(name: string, all: Record<string, ModelProfile>): string {
  const profile = all[name]
  const model = prettyModel(profile.model)
  const twins = Object.values(all).filter((p) => p.provider === profile.provider && p.model === profile.model)
  if (twins.length < 2) return model
  const options = (profile.options ?? {}) as { effort?: string; reasoningEffort?: string }
  const effort = options.effort ?? options.reasoningEffort
  return `${model} · ${effort ?? name}`
}

export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
  'lm-studio': 'LM Studio',
}

export const ROLE_LABEL: Record<string, string> = {
  reasoning: 'Thinking',
  fast: 'Quick',
  balanced: 'Balanced',
  vision: 'Vision',
}
