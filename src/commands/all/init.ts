import { mkdir, stat } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import { parse as parseJSONC } from 'jsonc-parser'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandDescription } from '#commands/mod.ts'
import { DIR_CODE, DIR_CODE_SERVICES, DIR_USER_SERVICES, SKY_CONFIG_DIR, SKY_CONFIG_PATH } from '#config'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import { exists, readDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { buildManifest } from './cli/_commandsManifest.ts'
import { parseWhoami } from './slack/cli/lib/agent-slack/mod.ts'
import { runAgentSlack } from './slack/lib/agentSlack.ts'

const CONTENT_DIRS = [
  'time',
  'decisions',
  'goals',
  'ideas',
  'library',
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
  commandDirs?: string[]
  slackWorkspace?: string
}): string {
  const dir = JSON.stringify(opts.dir)
  const userDataDir = JSON.stringify(opts.userDataDir)
  const editor = JSON.stringify(opts.editor)
  const commandsBlock =
    opts.commandDirs && opts.commandDirs.length > 0
      ? `,\n\n  // Additional command directories (e.g., sky-extras)\n  "commands": {\n    "dirs": ${JSON.stringify(opts.commandDirs)}\n  }`
      : ''
  const slackBlock = opts.slackWorkspace
    ? `,\n\n  // Slack workspace used by slack:* commands (detected via agent-slack CLI)\n  "slack": { "workspace": ${JSON.stringify(opts.slackWorkspace)} }`
    : `\n\n  // Slack workspace used by slack:* commands (requires the agent-slack CLI)\n  // "slack": { "workspace": "https://yourteam.slack.com" }`

  return `{
  // Sky configuration — https://github.com/skywrite/sky
  // Config version (do not change manually)
  "version": 1,

  // Root directory for your notebook (notes, journal, projects, etc.)
  "dir": ${dir},

  // Operational data directory (attachments, state — not git-tracked)
  "userDataDir": ${userDataDir},

  // Preferred editor for opening files after creation
  "editor": ${editor},

  // Life domains — the prefix on day-file sections ("Professional Todos").
  // Fixed for now: goals, recurring and scheduled items all assume this pair,
  // so editing it here does not change the sections Sky writes.
  "categories": ["Professional", "Personal"]${commandsBlock}${slackBlock}

  // AI model preferences (uncomment to override defaults)
  // "ai": {
  //   "models": {
  //     "strong": "anthropic/claude-sonnet-5",
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

function escapePlistString(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderServicePlistTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
    const value = vars[key]
    if (value === undefined) throw new Error(`Unknown service template variable: ${key}`)
    return escapePlistString(value)
  })
}

async function installServicePlists(editor: string): Promise<number> {
  if (!(await exists(DIR_CODE_SERVICES))) return 0

  await mkdir(DIR_USER_SERVICES, { recursive: true })

  const vars = {
    HOME: os.homedir(),
    EDITOR: editor,
    SKY_SERVICE_BIN: path.join(DIR_CODE, 'bin', 'sky-service'),
  }

  let count = 0
  for await (const entry of readDir(DIR_CODE_SERVICES)) {
    if (!entry.isFile || !entry.name.endsWith('.plist')) continue

    const templatePath = path.join(DIR_CODE_SERVICES, entry.name)
    const installPath = path.join(DIR_USER_SERVICES, entry.name)
    const rendered = renderServicePlistTemplate(await readTextFile(templatePath), vars)
    await writeTextFile(installPath, rendered)
    count++
  }

  return count
}

export default class InitCommand extends Command {
  static override description: CommandDescription = {
    name: 'init',
    description: 'Initialize a new Sky notebook',
  }

  async run(): Promise<CommandResult> {
    p.intro('Sky — initialize your notebook')

    let preservedCommandDirs: string[] = []
    let preservedSlackWorkspace: string | undefined
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
        const parsed = parseJSONC(await readTextFile(SKY_CONFIG_PATH)) as {
          commands?: { dirs?: string[] }
          slack?: { workspace?: string }
        }
        if (Array.isArray(parsed.commands?.dirs)) preservedCommandDirs = parsed.commands.dirs
        if (typeof parsed.slack?.workspace === 'string') preservedSlackWorkspace = parsed.slack.workspace
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

    // Detect agent-slack and its default workspace for slack:* commands
    s.start('Detecting agent-slack CLI...')
    let slackWorkspace = preservedSlackWorkspace
    if (await isCommandAvailable('agent-slack')) {
      const whoami = await runAgentSlack(['auth', 'whoami'])
      const parsed = whoami.success ? parseWhoami(whoami.stdout) : undefined
      const detected = parsed?.defaultWorkspaceUrl ?? parsed?.workspaceUrls[0]
      if (detected) slackWorkspace = detected
      s.stop(
        detected
          ? `agent-slack detected — Slack workspace ${detected}`
          : 'agent-slack detected — no workspace configured yet (see agent-slack auth)',
      )
    } else {
      s.stop('agent-slack not found — skipping Slack workspace config')
    }

    // Write config
    s.start('Writing config...')
    await mkdir(SKY_CONFIG_DIR, { recursive: true })
    const configContent = generateConfig({
      dir,
      userDataDir,
      editor,
      commandDirs: preservedCommandDirs,
      slackWorkspace,
    })
    await writeTextFile(SKY_CONFIG_PATH, configContent)
    s.stop(`Config written to ${SKY_CONFIG_PATH}`)

    // Install launchd service plists
    s.start('Installing service plists...')
    const serviceCount = await installServicePlists(editor)
    s.stop(
      serviceCount > 0
        ? `Installed ${serviceCount} service plist${serviceCount === 1 ? '' : 's'} to ${DIR_USER_SERVICES}`
        : 'No service plists to install',
    )

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
