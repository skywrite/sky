import * as path from 'node:path'
import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_HOME } from '#config'
import openEditor from '#lib/shell/openEditor.ts'
import { getProfile } from '#shared/ai/models.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import scanClaudeSessions, { renderClaudeCodeRecap } from './lib/claudeCode.ts'
import { clockPrefix, dayClock } from './lib/clock.ts'
import dayWindow from './lib/dayWindow.ts'
import { digestSessions } from './lib/sessionDigest.ts'
import writeRecapFile from './lib/writeRecapFile.ts'

const APP = 'claude-code'

// Digests are extraction, not prose-writing — the fast tier is enough.
const DEFAULT_DIGEST_PROFILE = 'default-haiku-4.5'

const params = {
  day: dayNoFutureArg(),
  dryRun: Flag.bool('Render the recap without writing it', { default: false }),
  open: Flag.bool('Open the recap in the editor after writing', { short: 'o', default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
  noAi: Flag.bool('Skip AI session digests (mechanical trail only)', { default: false }),
  model: Flag.string('Model profile for session digests', {
    short: 'm',
    default: () => DEFAULT_DIGEST_PROFILE,
  }),
  projectsDir: Flag.string('Claude Code projects directory', {
    default: () => path.join(DIR_HOME, '.claude', 'projects'),
  }),
}

type Params = InferParams<typeof params>
type Result = { file?: string; sessions: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'recap:claude-code': { params: Params; result: Result }
  }
}

export default class RecapClaudeCodeTask extends Command {
  static override description: CommandDescription = {
    name: 'recap:claude-code',
    description: "Recap the day's Claude Code sessions into actions/recaps/",
    descriptionLong: [
      'Digests Claude Code session transcripts into one recap doc for the day.',
      'Each session becomes a block: span, an AI-extracted title/about plus',
      'Decided/Built/Open/Learned bullets, degrading to the mechanical trail',
      '(work dirs, commits, commands) when AI is skipped or fails.',
      '',
      'The recap is evidence for summary:day — engagement as counts and spans,',
      'never an hours-worked figure. Re-running replaces the recap for the day.',
    ],
    usage: [
      'sky recap:claude-code              # Recap today',
      'sky recap:claude-code 2026-02-08   # Recap a specific day',
      'sky recap:claude-code --dry-run    # Render without writing',
      'sky recap:claude-code --no-ai      # Mechanical trail only',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { day, dryRun, open, rel, noAi, model, projectsDir } = args

    // A bad -m should fail before any scanning happens.
    if (!noAi) {
      try {
        getProfile(model)
      } catch (err) {
        return CommandResult.fail((err as Error).message)
      }
    }

    const window = await dayWindow(day)
    const sessions = await scanClaudeSessions(projectsDir, window)

    if (sessions.length === 0) {
      output.log(`No Claude Code activity found for ${day.ymd}.`)
      return CommandResult.success({ sessions: 0 })
    }

    let digests
    if (!noAi) {
      output.log(`Digesting ${sessions.length} session${sessions.length === 1 ? '' : 's'}...`)
      digests = await digestSessions(sessions, model, day, window.timezone)
      const failed = digests.filter((digest) => digest === null).length
      if (failed > 0) output.log(`${failed} digest${failed === 1 ? '' : 's'} failed — using the mechanical trail.`)
    }

    const rendered = renderClaudeCodeRecap(sessions, day, window.timezone, digests)
    const firstClock = dayClock(rendered.first, day, window.timezone)
    const lastClock = dayClock(rendered.last, day, window.timezone)
    const when = firstClock === lastClock ? `${day.ymd} ${firstClock}` : `${day.ymd} ${firstClock} - ${lastClock}`

    const relList = rel
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    const doc = RecapDocument.create({
      app: APP,
      what: 'Coding - Claude Code',
      when,
      rel: relList?.length ? relList : undefined,
      body: rendered.body,
    })
    const contents = doc.toMarkdown()

    if (dryRun) {
      output.log(contents)
      return CommandResult.success({ sessions: sessions.length })
    }

    const file = await writeRecapFile({ day, app: APP, prefix: clockPrefix(firstClock), contents })
    output.log(`Recapped ${sessions.length} Claude Code session${sessions.length === 1 ? '' : 's'} → ${file}`)

    if (open) openEditor([{ file }])

    return CommandResult.success({ file, sessions: sessions.length })
  }
}
