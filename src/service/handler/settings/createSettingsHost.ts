import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import * as os from 'node:os'
import process from 'node:process'
import { promisify } from 'node:util'
import { getMacWhisperModels } from '#commands/all/audio/transcript/lib/macwhisper.ts'
import { preferredResearcherVoice, preferredVoice, VOICE_GROUPS } from '#commands/lib/voice/sessionConfig.ts'
import { DIR_AI_MEMORY, DIR_CODE } from '#config'
import * as notebookConfig from '#config'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import { createWritingLessons } from '#lib/writingVoice/runtime.ts'
import { KNOWN_PROVIDERS, PROFILES, ROLES } from '#shared/ai/models.ts'
import { loadSkyConfig, readSkyConfigFile, SKY_CONFIG_PATH } from '#shared/config/loader.ts'
import { removeConfigValue, setConfigValue } from '#shared/config/write.ts'
import { createPromptCatalog } from '#shared/prompts/load.ts'
import { createAboutMeHost } from './createAboutMeHost.ts'
import { createConnectionsHost } from './createConnectionsHost.ts'
import {
  BOOLEAN_KEYS,
  choiceLabel,
  PROVIDER_LABEL,
  ROLE_LABEL,
  SETTABLE_KEYS,
  type ModelRow,
  type RevealTarget,
  type SettingsRoutesOptions,
} from './mod.ts'

const run = promisify(execFile)

/** Editors worth looking for; the configured one joins the list either way. */
const EDITOR_CANDIDATES = ['code', 'cursor', 'zed', 'subl', 'typora', 'marktext', 'obsidian']

/** The build the service runs, asked of git once per process. */
let build: Promise<{ version: string | null; date: string | null }> | null = null
function aboutBuild(): Promise<{ version: string | null; date: string | null }> {
  build ??= run('git', ['-C', DIR_CODE, 'log', '-1', '--format=%h\t%cs'])
    .then(({ stdout }) => {
      const [version, date] = stdout.trim().split('\t')
      return { version: version || null, date: date || null }
    })
    .catch(() => ({ version: null, date: null }))
  return build
}

/** The settings page over the real machine: the file, the preferences, the keychain, git, Finder. */
export function createSettingsHost(): SettingsRoutesOptions {
  return {
    macWhisperModels: getMacWhisperModels,
    load: () => ({
      path: SKY_CONFIG_PATH,
      home: os.homedir(),
      config: loadSkyConfig(),
      file: readSkyConfigFile(),
      env: process.env,
    }),
    voices: () => ({ current: preferredVoice(), researcherCurrent: preferredResearcherVoice(), groups: VOICE_GROUPS }),
    models: (): ModelRow[] =>
      Object.entries(ROLES).map(([role, profileName]) => {
        const profile = PROFILES[profileName]
        return {
          role,
          label: ROLE_LABEL[role] ?? role,
          value: `${choiceLabel(profileName, PROFILES)} · ${PROVIDER_LABEL[profile.provider] ?? profile.provider}`,
          profile: profileName,
        }
      }),
    builtinProfiles: () =>
      Object.entries(PROFILES).map(([name, profile]) => ({
        name,
        provider: profile.provider,
        model: profile.model,
        ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        ...(profile.contextWindow ? { contextWindow: profile.contextWindow } : {}),
        ...(profile.options ? { options: profile.options as Record<string, unknown> } : {}),
      })),
    providers: () => [...KNOWN_PROVIDERS],
    writeProfile: (name, profile) => {
      setConfigValue(['ai', 'profiles', name], profile)
      return Promise.resolve()
    },
    deleteProfile: (name) => {
      removeConfigValue(['ai', 'profiles', name])
      return Promise.resolve()
    },
    editors: async () => {
      const present = await Promise.all(EDITOR_CANDIDATES.map(async (c) => ((await isCommandAvailable(c)) ? c : null)))
      const editors = present.filter((c): c is string => c !== null)
      const configured = loadSkyConfig().editor
      if (configured && !editors.includes(configured)) editors.unshift(configured)
      return editors
    },
    memoryNotes: async () => {
      try {
        return (await readdir(DIR_AI_MEMORY)).filter((name) => name.endsWith('.md')).length
      } catch {
        return 0
      }
    },
    about: aboutBuild,
    write: (key, value) => {
      setConfigValue([...SETTABLE_KEYS[key]], BOOLEAN_KEYS.has(key) ? value === 'true' : value)
      return Promise.resolve()
    },
    writeAccountCategory: (email, category) => {
      setConfigValue(['google', 'accountCategories', email], category)
      return Promise.resolve()
    },
    connections: createConnectionsHost(),
    aboutMe: createAboutMeHost(notebookConfig),
    prompts: createPromptCatalog(),
    writingVoice: createWritingLessons(notebookConfig),
    reveal: async (target: RevealTarget) => {
      if (process.platform !== 'darwin') throw new Error('Reveal works on macOS only for now.')
      const config = loadSkyConfig()
      const at = target === 'dir' ? config.dir : target === 'userDataDir' ? config.userDataDir : SKY_CONFIG_PATH
      await run('open', [at])
    },
  }
}
