import { readFileSync, existsSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { parse } from 'jsonc-parser'
import { DEFAULT_LAYOUT_PATTERN, LAYOUT_PATTERNS, layoutByPattern } from '../nbfs/layout/registry.ts'
import type { SkyConfig } from './types.ts'

export const SKY_CONFIG_DIR = path.join(os.homedir(), '.sky')
export const SKY_CONFIG_PATH = path.join(SKY_CONFIG_DIR, 'config.jsonc')

/** The environment variables that outrank the file, and the key each one sets. */
export const ENV_OVERRIDES: ReadonlyArray<{
  env: string
  key: 'dir' | 'userDataDir' | 'codeDir' | 'inputDir' | 'outputDir'
}> = [
  { env: 'SKY_DIR', key: 'dir' },
  { env: 'SKY_DATA_DIR', key: 'userDataDir' },
  { env: 'SKY_CODE_DIR', key: 'codeDir' },
  { env: 'SKY_INPUT_DIR', key: 'inputDir' },
  { env: 'SKY_OUTPUT_DIR', key: 'outputDir' },
]

function detectCodeDir(): string {
  // Walk up from this file: config/ → _shared-ts/ → src/ → sky/
  // Use realpathSync to canonicalize case (macOS is case-insensitive but
  // Bun's module cache keys on exact path strings — mismatched case causes
  // duplicate module instances and broken instanceof checks)
  // Note: import.meta.dirname is undefined in webpack bundles (e.g. VSCode extension)
  if (!import.meta.dirname) return ''
  return realpathSync(path.resolve(import.meta.dirname, '..', '..', '..'))
}

function expandTilde(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

/**
 * Canonicalize path case on macOS.
 * macOS is case-insensitive but Bun's module cache keys on exact path strings.
 * Mismatched case causes duplicate module instances
 * and broken instanceof checks. This walks each path component and matches the
 * actual filesystem case via readdir.
 */
function canonicalizePath(p: string): string {
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const segments = p.split(path.sep)
    let resolved = segments[0] === '' ? path.sep : segments[0]

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]
      if (!seg) continue
      try {
        const entries = readdirSync(resolved)
        const match = entries.find((e: string) => e.toLowerCase() === seg.toLowerCase())
        resolved = path.join(resolved, match ?? seg)
      } catch {
        // Directory doesn't exist yet — use as-is for remaining segments
        resolved = path.join(resolved, ...segments.slice(i))
        break
      }
    }
    return resolved
  } catch {
    return p
  }
}

function defaults(): SkyConfig {
  return {
    version: 1,
    dir: path.join(os.homedir(), 'Sky'),
    userDataDir: path.join(os.homedir(), 'Sky-Data'),
    codeDir: detectCodeDir(),
    inputDir: path.join(os.homedir(), 'Desktop'),
    outputDir: path.join(os.homedir(), 'Desktop'),
    editor: undefined,
    categories: ['Professional', 'Personal'],
    commands: {
      dirs: [],
      day: {
        start: ['day:sr:update', 'prices:all:fetch', 'util:weather'],
        end: ['day:todo:incomplete'],
      },
    },
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
    nbfs: { layout: DEFAULT_LAYOUT_PATTERN },
  }
}

/** The file as written — its text and what it parses to; null when there is none. */
export function readSkyConfigFile(configPath = SKY_CONFIG_PATH): { text: string; parsed: Partial<SkyConfig> } | null {
  if (!existsSync(configPath)) return null
  const text = readFileSync(configPath, 'utf-8')
  return { text, parsed: parse(text) as Partial<SkyConfig> }
}

export function loadSkyConfig(): SkyConfig {
  const config = defaults()

  const file = readSkyConfigFile()
  if (file) {
    const { parsed } = file

    if (parsed.version && parsed.version > 1) {
      console.warn(
        `sky.config.jsonc version ${parsed.version} is newer than supported (1). Unknown fields use defaults.`,
      )
    }

    if (parsed.dir) config.dir = expandTilde(parsed.dir)
    if (parsed.userDataDir) config.userDataDir = expandTilde(parsed.userDataDir)
    if (parsed.codeDir) config.codeDir = expandTilde(parsed.codeDir)
    if (parsed.inputDir) config.inputDir = expandTilde(parsed.inputDir)
    if (parsed.outputDir) config.outputDir = expandTilde(parsed.outputDir)
    if (parsed.editor) config.editor = parsed.editor
    if (parsed.categories) config.categories = parsed.categories
    if (parsed.commands?.dirs) config.commands.dirs = parsed.commands.dirs.map(expandTilde)
    if (parsed.commands?.day?.start) config.commands.day.start = parsed.commands.day.start
    if (parsed.commands?.day?.end) config.commands.day.end = parsed.commands.day.end
    if (parsed.bins) config.bins = { ...config.bins, ...parsed.bins }
    if (parsed.slack?.workspace) config.slack.workspace = parsed.slack.workspace
    if (parsed.web?.theme && ['system', 'light', 'dark'].includes(parsed.web.theme)) config.web.theme = parsed.web.theme
    if (parsed.web?.textSize && ['default', 'large'].includes(parsed.web.textSize)) {
      config.web.textSize = parsed.web.textSize
    }
    if (parsed.voice?.voice) config.voice.voice = parsed.voice.voice
    if (parsed.ai?.models) config.ai.models = { ...config.ai.models, ...parsed.ai.models }
    if (parsed.ai?.profiles) config.ai.profiles = parsed.ai.profiles
    if (parsed.server?.port) config.server.port = parsed.server.port
    if (parsed.nbfs?.layout) {
      if (layoutByPattern(parsed.nbfs.layout)) {
        config.nbfs.layout = parsed.nbfs.layout
      } else {
        console.warn(
          `sky config: unknown nbfs.layout "${parsed.nbfs.layout}" - using ${DEFAULT_LAYOUT_PATTERN}. Supported: ${LAYOUT_PATTERNS.join(', ')}`,
        )
      }
    }
  }

  // Env var overrides (highest precedence)
  for (const { env, key } of ENV_OVERRIDES) {
    const value = process.env[env]
    if (value) config[key] = value
  }

  // Canonicalize path case (macOS is case-insensitive but Bun's module
  // cache keys on exact strings — mismatched case breaks instanceof)
  config.dir = canonicalizePath(config.dir)
  config.userDataDir = canonicalizePath(config.userDataDir)
  config.codeDir = canonicalizePath(config.codeDir)

  return config
}
