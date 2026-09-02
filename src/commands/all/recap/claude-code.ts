import * as path from 'node:path'
import { Command, CommandResult, dayYesterdayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_HOME } from '#config'
import enrichRecap from '#lib/notebook/enrich/enrichRecap.ts'
import readRecapCuration from '#lib/notebook/recap/readRecapCuration.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { getProfile } from '#shared/ai/models.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import scanClaudeSessions, { renderClaudeCodeRecap } from './lib/claudeCode.ts'
import { clockPrefix, dayClock } from './lib/clock.ts'
import dayWindow from './lib/dayWindow.ts'
import { digestSessions } from './lib/sessionDigest.ts'
import findWakeCutoff, { findWakeStart } from './lib/wakeGap.ts'
import writeRecapFile from './lib/writeRecapFile.ts'

const APP = 'claude-code'
const WHAT = 'Coding - Claude Code'
// What the tag and rel classifiers are told they are labeling.
const KIND = 'daily Claude Code session recap'

// How far before the day:start ceremony to look for the day's true beginning
// (work done after waking but before running day:start).
const WAKE_LOOKBACK_MS = 12 * 3_600_000

// Digests are extraction, not prose-writing — the fast tier is enough.
const DEFAULT_DIGEST_PROFILE = 'default-haiku-4.5'

const params = {
  day: dayYesterdayArg(),
  dryRun: Flag.bool('Render the recap without writing it', { default: false }),
  noEditor: Flag.bool('Skip opening the recap in the editor', { default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
  noAi: Flag.bool('Skip AI session digests and auto tags/rel (mechanical trail only)', { default: false }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-recaps tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
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
      'never an hours-worked figure. The day defaults to yesterday so a bare',
      'run always covers a completed day. Re-running replaces the recap.',
    ],
    usage: [
      'sky recap:claude-code              # Recap yesterday',
      'sky recap:claude-code 2026-02-08   # Recap a specific day',
      'sky recap:claude-code --dry-run    # Render without writing',
      'sky recap:claude-code --no-ai      # Mechanical trail only',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { day, dryRun, noEditor, rel, noAi, noAutoTag, noAutoRel, model, projectsDir } = args

    // A bad -m should fail before any scanning happens.
    if (!noAi) {
      try {
        getProfile(model)
      } catch (err) {
        return CommandResult.fail((err as Error).message)
      }
    }

    const window = await dayWindow(day)

    // The ceremony window (day:start to day:start) misfiles work around
    // sleep: the day really runs wake to wake. Scan wide, find both wake
    // boundaries in the activity signal (typed prompts plus session activity
    // edges — a session reopened the next morning has an edge there but no
    // overnight events), then scan again on the true window.
    const wideSessions = await scanClaudeSessions(projectsDir, {
      start: new Date(window.start.getTime() - WAKE_LOOKBACK_MS),
      end: window.end,
    })
    const activitySignal = wideSessions
      .flatMap((session) => [session.start, session.end, ...session.promptLog.map((prompt) => prompt.instant)])
      .sort((a, b) => a.getTime() - b.getTime())
    const start = findWakeStart(activitySignal, day, window.timezone, window.start) ?? window.start
    const cutoff = findWakeCutoff(
      activitySignal.filter((instant) => instant >= start),
      day,
      window.timezone,
    )
    const end = cutoff ? new Date(cutoff.getTime() + 60_000) : window.end

    const sessions = await scanClaudeSessions(projectsDir, { start, end })

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

    // Re-runs keep the human-curated slots from the existing file; the
    // classifiers fill only what is still empty. --no-ai means no AI at all.
    const curation = await readRecapCuration(day, APP)
    const curated = await enrichRecap(
      { app: APP, what: WHAT, body: rendered.body, kind: KIND },
      { rel: relList?.length ? relList : curation.rel, tags: curation.tags },
      { noAutoTag: noAi || noAutoTag, noAutoRel: noAi || noAutoRel, log: (line) => output.log(line) },
    )

    const doc = RecapDocument.create({
      app: APP,
      what: WHAT,
      when,
      rel: curated.rel,
      tags: curated.tags,
      body: rendered.body,
    })
    const contents = doc.toMarkdown()

    if (dryRun) {
      output.log(contents)
      return CommandResult.success({ sessions: sessions.length })
    }

    const file = await writeRecapFile({ day, app: APP, prefix: clockPrefix(firstClock), contents })
    output.log(`Recapped ${sessions.length} Claude Code session${sessions.length === 1 ? '' : 's'} → ${file}`)

    // The recap is meant to be looked at — pop it into the editor.
    if (!noEditor) await openEditor([{ file }])

    return CommandResult.success({ file, sessions: sessions.length })
  }
}
