import * as path from 'node:path'
import * as os from 'node:os'
import { mkdir, stat } from 'node:fs/promises'
import * as p from '@clack/prompts'
import { parse as parseJSONC } from 'jsonc-parser'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandDescription } from '#commands/mod.ts'
import { SKY_CONFIG_DIR, SKY_CONFIG_PATH } from '#config'
import { buildManifest } from './cli/_commandsManifest.ts'

const CONTENT_DIRS = [
  'time',
  'decisions',
  'goals',
  'heartbeat',
  'heartbeat/follow',
  'ideas',
  'notes',
  'people',
  'places',
  'places/locations',
  'projects',
  'projects/open',
  'orgs',
  'data',
  'journal',
]

const STARTER_FILES: Record<string, string> = {
  'time/next-professional.md': '---\ntitle: Next Professional\n---\n\n',
  'time/next-personal.md': '---\ntitle: Next Personal\n---\n\n',
  'time/recurring-professional.md': '---\ntitle: Recurring Professional\n---\n\n',
  'time/recurring-personal.md': '---\ntitle: Recurring Personal\n---\n\n',
  'time/reminders.md': '---\ntitle: Reminders\n---\n\n',
  'goals/personal.md': '---\ntitle: Personal Goals\n---\n\n',
  'goals/professional.md': '---\ntitle: Professional Goals\n---\n\n',
}

function generateConfig(opts: {
  dir: string
  userDataDir: string
  editor: string
  categories: string[]
  commandDirs?: string[]
}): string {
  const cats = JSON.stringify(opts.categories)
  const dir = JSON.stringify(opts.dir)
  const userDataDir = JSON.stringify(opts.userDataDir)
  const editor = JSON.stringify(opts.editor)
  const commandsBlock =
    opts.commandDirs && opts.commandDirs.length > 0
      ? `,\n\n  // Additional command directories (e.g., sky-extras)\n  "commands": {\n    "dirs": ${JSON.stringify(opts.commandDirs)}\n  }`
      : ''

  return `{
  // Sky configuration — https://github.com/skynotebook/sky
  // Config version (do not change manually)
  "version": 1,

  // Root directory for your notebook (notes, journal, projects, etc.)
  "dir": ${dir},

  // Operational data directory (attachments, state — not git-tracked)
  "userDataDir": ${userDataDir},

  // Preferred editor for opening files after creation
  "editor": ${editor},

  // Life domains — become section headers in day files (e.g., "Professional Todos")
  "categories": ${cats}${commandsBlock}

  // AI model preferences (uncomment to override defaults)
  // "ai": {
  //   "models": {
  //     "strong": "anthropic/claude-sonnet-4-20250514",
  //     "fast": "openai/gpt-4o-mini",
  //     "transcription": "openai/gpt-4o-transcribe"
  //   }
  // },

  // Server port for the Sky service
  // "server": { "port": 9999 }
}
`
}

function resolvePromptPath(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2))
  return path.resolve(input)
}

function normalizeDirectoryInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return trimmed
  if (/^\/+$/.test(trimmed)) return '/'
  return trimmed.replace(/\/+$/, '')
}

async function ensureDirectory(dir: string, label: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const info = await stat(dir)
  if (!info.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${dir}`)
  }
}

export default class InitCommand extends Command {
  static override description: CommandDescription = {
    name: 'init',
    description: 'Initialize a new Sky notebook',
  }

  async run(): Promise<CommandResult> {
    p.intro('Sky — initialize your notebook')

    let preservedCommandDirs: string[] = []
    if (await exists(SKY_CONFIG_PATH)) {
      const overwrite = await p.confirm({
        message: `${SKY_CONFIG_PATH} already exists. Overwrite?`,
        initialValue: false,
      })
      if (p.isCancel(overwrite) || !overwrite) {
        p.outro('Cancelled.')
        return CommandResult.success()
      }
      try {
        const parsed = parseJSONC(await readTextFile(SKY_CONFIG_PATH)) as { commands?: { dirs?: string[] } }
        if (Array.isArray(parsed.commands?.dirs)) preservedCommandDirs = parsed.commands.dirs
      } catch {}
    }

    const defaultDir = path.join(os.homedir(), 'Sky')

    let dir = await p.text({
      message: 'Where should Sky store your notebook?',
      placeholder: defaultDir,
      defaultValue: defaultDir,
    })
    if (p.isCancel(dir)) return CommandResult.success()
    const normalizedDir = normalizeDirectoryInput(dir)
    if (!normalizedDir) throw new Error('Notebook path cannot be empty.')
    dir = normalizedDir
    const resolvedDir = resolvePromptPath(dir)

    const defaultDataDir = dir + '-Data'
    let userDataDir = await p.text({
      message: 'Where should Sky store data files?',
      placeholder: defaultDataDir,
      defaultValue: defaultDataDir,
    })
    if (p.isCancel(userDataDir)) return CommandResult.success()
    const normalizedUserDataDir = normalizeDirectoryInput(userDataDir)
    if (!normalizedUserDataDir) throw new Error('User data path cannot be empty.')
    userDataDir = normalizedUserDataDir
    const resolvedUserDataDir = resolvePromptPath(userDataDir)

    const editor = await p.text({ message: 'Preferred editor?', placeholder: 'code', defaultValue: 'code' })
    if (p.isCancel(editor)) return CommandResult.success()

    const categoriesInput = await p.text({
      message: 'Life domains / categories?',
      placeholder: 'Professional, Personal',
      defaultValue: 'Professional, Personal',
    })
    if (p.isCancel(categoriesInput)) return CommandResult.success()

    const categories = categoriesInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)

    const s = p.spinner()

    // Create content directories
    s.start('Creating notebook directories...')
    await ensureDirectory(resolvedDir, 'Notebook')
    for (const d of CONTENT_DIRS) {
      await mkdir(path.join(resolvedDir, d), { recursive: true })
    }
    s.stop(`Created ${CONTENT_DIRS.length} directories in ${resolvedDir}`)

    // Create starter files
    s.start('Creating starter files...')
    let starterCount = 0
    for (const [relPath, content] of Object.entries(STARTER_FILES)) {
      const fullPath = path.join(resolvedDir, relPath)
      if (!(await exists(fullPath))) {
        await writeTextFile(fullPath, content)
        starterCount++
      }
    }
    s.stop(starterCount > 0 ? `Created ${starterCount} starter files` : 'Starter files already exist')

    // Create user data directories
    s.start('Creating data directories...')
    await ensureDirectory(resolvedUserDataDir, 'User data')
    for (const d of ['attachments', 'state', 'tmp']) {
      await mkdir(path.join(resolvedUserDataDir, d), { recursive: true })
    }
    s.stop(`Created data directories in ${resolvedUserDataDir}`)

    // Write config
    s.start('Writing config...')
    await mkdir(SKY_CONFIG_DIR, { recursive: true })
    const configContent = generateConfig({
      dir,
      userDataDir,
      editor,
      categories,
      commandDirs: preservedCommandDirs,
    })
    await writeTextFile(SKY_CONFIG_PATH, configContent)
    s.stop(`Config written to ${SKY_CONFIG_PATH}`)

    // Build command manifest
    s.start('Building command manifest...')
    await buildManifest()
    s.stop('Command manifest built')

    p.outro(`Done! Next steps:
  sky day:start              Start your first day
  sky journal:me:update      Tell Sky about yourself (powers AI coaching)
  sky journal:new            Write your first journal entry`)

    return CommandResult.success()
  }
}
