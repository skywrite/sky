import * as path from 'node:path'
import * as os from 'node:os'
import { mkdir } from 'node:fs/promises'
import * as p from '@clack/prompts'
import { exists, writeTextFile } from '#shared/fs/mod.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
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

function generateConfig(opts: { dir: string; userDataDir: string; editor: string; categories: string[] }): string {
  const cats = JSON.stringify(opts.categories)
  return `{
  // Sky configuration — https://github.com/skynotebook/sky
  // Config version (do not change manually)
  "version": 1,

  // Root directory for your notebook (notes, journal, projects, etc.)
  "dir": "${opts.dir}",

  // Operational data directory (attachments, state — not git-tracked)
  "userDataDir": "${opts.userDataDir}",

  // Preferred editor for opening files after creation
  "editor": "${opts.editor}",

  // Life domains — become section headers in day files (e.g., "Professional Todos")
  "categories": ${cats}

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

function toTildePath(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

export default class InitCommand extends Command {
  static override description: CommandDescription = {
    name: 'init',
    description: 'Initialize a new Sky notebook',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context

    p.intro('Sky — initialize your notebook')

    if (await exists(SKY_CONFIG_PATH)) {
      const overwrite = await p.confirm({
        message: `${SKY_CONFIG_PATH} already exists. Overwrite?`,
        initialValue: false,
      })
      if (p.isCancel(overwrite) || !overwrite) {
        p.outro('Cancelled.')
        return CommandResult.success()
      }
    }

    const defaultDir = path.join(os.homedir(), 'Sky')

    const dir = await p.text({
      message: 'Where should Sky store your notebook?',
      placeholder: defaultDir,
      defaultValue: defaultDir,
    })
    if (p.isCancel(dir)) return CommandResult.success()

    const defaultDataDir = dir + '-Data'
    const userDataDir = await p.text({
      message: 'Where should Sky store data files?',
      placeholder: defaultDataDir,
      defaultValue: defaultDataDir,
    })
    if (p.isCancel(userDataDir)) return CommandResult.success()

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

    // Write config
    s.start('Writing config...')
    await mkdir(SKY_CONFIG_DIR, { recursive: true })
    const configContent = generateConfig({
      dir: toTildePath(dir),
      userDataDir: toTildePath(userDataDir),
      editor,
      categories,
    })
    await writeTextFile(SKY_CONFIG_PATH, configContent)
    s.stop(`Config written to ${SKY_CONFIG_PATH}`)

    // Create content directories
    s.start('Creating notebook directories...')
    for (const d of CONTENT_DIRS) {
      await mkdir(path.join(dir, d), { recursive: true })
    }
    s.stop(`Created ${CONTENT_DIRS.length} directories in ${dir}`)

    // Create starter files
    s.start('Creating starter files...')
    let starterCount = 0
    for (const [relPath, content] of Object.entries(STARTER_FILES)) {
      const fullPath = path.join(dir, relPath)
      if (!(await exists(fullPath))) {
        await writeTextFile(fullPath, content)
        starterCount++
      }
    }
    s.stop(starterCount > 0 ? `Created ${starterCount} starter files` : 'Starter files already exist')

    // Create user data directories
    s.start('Creating data directories...')
    for (const d of ['attachments', 'state', 'tmp']) {
      await mkdir(path.join(userDataDir, d), { recursive: true })
    }
    s.stop(`Created data directories in ${userDataDir}`)

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
