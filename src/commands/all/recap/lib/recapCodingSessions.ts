import { CommandResult, dayYesterdayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import enrichRecap from '#lib/notebook/enrich/enrichRecap.ts'
import readRecapCuration from '#lib/notebook/recap/readRecapCuration.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { getProfile } from '#shared/ai/models.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { clockPrefix, dayClock } from './clock.ts'
import { renderCodingRecap, type CodingSession, type ScanWindow } from './codingSession.ts'
import dayWindow from './dayWindow.ts'
import { digestSessions } from './sessionDigest.ts'
import findWakeCutoff, { findWakeStart } from './wakeGap.ts'
import writeRecapFile from './writeRecapFile.ts'

// Extraction uses the same fast model profile for both transcript sources.
const DEFAULT_DIGEST_PROFILE = 'default-haiku-4.5'

export const codingRecapParams = {
  day: dayYesterdayArg(),
  dryRun: Flag.bool('Render the recap without writing it', { default: false }),
  noEditor: Flag.bool('Skip opening the recap in the editor', { default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
  noAi: Flag.bool('Skip AI session digests and auto tags/rel (mechanical trail only)', { default: false }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-recaps tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  model: Flag.string('Model profile for session digests', {
    long: 'ai-model',
    short: 'm',
    default: () => DEFAULT_DIGEST_PROFILE,
  }),
}

export type CodingRecapParams = InferParams<typeof codingRecapParams>
export type CodingRecapResult = { file?: string; sessions: number }

interface CodingRecapSource {
  app: string
  label: string
  scan: (window: ScanWindow) => Promise<CodingSession[]>
}

export function codingRecapDescription(app: string, label: string): Omit<CommandDescription, 'params'> {
  return {
    name: `recap:${app}`,
    description: `Recap the day's ${label} sessions into ${actionKindRel('recap')}/`,
    descriptionLong: [
      `Digests ${label} session transcripts into one recap doc for the day.`,
      'Each session becomes a block: span, an AI-extracted title/about plus',
      'Decided/Built/Open/Learned bullets, degrading to the mechanical trail',
      '(work dirs, commits, commands) when AI is skipped or fails.',
      '',
      'The recap is evidence for summary:day — engagement as counts and spans,',
      'never an hours-worked figure. The day defaults to yesterday so a bare',
      'run always covers a completed day. Re-running replaces the recap.',
    ],
    usage: [
      `sky recap:${app}              # Recap yesterday`,
      `sky recap:${app} 2026-02-08   # Recap a specific day`,
      `sky recap:${app} --dry-run    # Render without writing`,
      `sky recap:${app} --no-ai      # Mechanical trail only`,
    ],
  }
}

export async function recapCodingSessions(
  { args, context }: CommandArgs<CodingRecapParams>,
  source: CodingRecapSource,
): Promise<CommandResult<CodingRecapResult>> {
  const { output } = context
  const { day, dryRun, noEditor, rel, noAi, noAutoTag, noAutoRel, model } = args
  const { app, label, scan } = source

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
  const wideSessions = await scan({
    start: window.start.subtract({ hours: 12 }),
    end: window.end,
  })
  const activitySignal = wideSessions
    .flatMap((session) => [session.start, session.end, ...session.promptLog.map((prompt) => prompt.instant)])
    .sort((a, b) => Instant.compare(a, b))
  const start = findWakeStart(activitySignal, day, window.timezone, window.start) ?? window.start
  const cutoff = findWakeCutoff(
    activitySignal.filter((instant) => Instant.compare(instant, start) >= 0),
    day,
    window.timezone,
  )
  const end = cutoff ? cutoff.add({ minutes: 1 }) : window.end

  const sessions = await scan({ start, end })

  if (sessions.length === 0) {
    output.log(`No ${label} activity found for ${day.ymd}.`)
    return CommandResult.success({ sessions: 0 })
  }

  let digests
  if (!noAi) {
    output.log(`Digesting ${sessions.length} session${sessions.length === 1 ? '' : 's'}...`)
    digests = await digestSessions(sessions, model, day, window.timezone, `recap:${app}`)
    const failed = digests.filter((digest) => digest === null).length
    if (failed > 0) output.log(`${failed} digest${failed === 1 ? '' : 's'} failed — using the mechanical trail.`)
  }

  const rendered = renderCodingRecap(sessions, label, day, window.timezone, digests)
  const firstClock = dayClock(rendered.first, day, window.timezone)
  const lastClock = dayClock(rendered.last, day, window.timezone)
  const when = firstClock === lastClock ? `${day.ymd} ${firstClock}` : `${day.ymd} ${firstClock} - ${lastClock}`

  const relList = rel
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  // Re-runs keep the human-curated slots from the existing file; the
  // classifiers fill only what is still empty. --no-ai means no AI at all.
  const curation = await readRecapCuration(day, app)
  const curated = await enrichRecap(
    { app, what: `Coding - ${label}`, body: rendered.body, kind: `daily ${label} session recap` },
    { rel: relList?.length ? relList : curation.rel, tags: curation.tags },
    { noAutoTag: noAi || noAutoTag, noAutoRel: noAi || noAutoRel, log: (line) => output.log(line) },
  )

  const doc = RecapDocument.create({
    app,
    what: `Coding - ${label}`,
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

  const file = await writeRecapFile({ day, app, prefix: clockPrefix(firstClock), contents })
  output.log(`Recapped ${sessions.length} ${label} session${sessions.length === 1 ? '' : 's'} → ${file}`)

  // The recap is meant to be looked at — pop it into the editor.
  if (!noEditor) await openEditor([{ file }])

  return CommandResult.success({ file, sessions: sessions.length })
}
