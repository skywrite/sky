import colors from 'picocolors'
import { Command, CommandResult, dayYesterdayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import enrichRecap from '#lib/notebook/enrich/enrichRecap.ts'
import readRecapCuration from '#lib/notebook/recap/readRecapCuration.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { isCommandAvailable } from '#lib/sys/command.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import { clockPrefix, dayClock } from './lib/clock.ts'
import dayWindow from './lib/dayWindow.ts'
import { activityInstants, clampActivity, renderGithubRecap } from './lib/github.ts'
import { fetchGithubActivity } from './lib/githubFetch.ts'
import findWakeCutoff, { findWakeStart } from './lib/wakeGap.ts'
import writeRecapFile from './lib/writeRecapFile.ts'

const APP = 'github'
const WHAT = 'Code - GitHub'
// What the tag and rel classifiers are told they are labeling.
const KIND = 'daily GitHub activity recap'

// How far before the day:start ceremony to look for the day's true beginning.
const WAKE_LOOKBACK_MS = 12 * 3_600_000

const params = {
  day: dayYesterdayArg(),
  dryRun: Flag.bool('Render the recap without writing it', { default: false }),
  noEditor: Flag.bool('Skip opening the recap in the editor', { default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-recaps tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { file?: string; repos: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'recap:github': { params: Params; result: Result }
  }
}

export default class RecapGithubTask extends Command {
  static override description: CommandDescription = {
    name: 'recap:github',
    description: "Recap the day's GitHub activity into actions/recaps/",
    descriptionLong: [
      'Digests your GitHub activity into one recap doc for the day: per-repo',
      'commits (authored times), PRs opened/merged, reviews and issue activity,',
      'linking back to the substance on GitHub.',
      '',
      'Uses the gh CLI for auth and API access. The day defaults to yesterday',
      'so a bare run always covers a completed day. Re-running replaces the recap.',
    ],
    usage: [
      'sky recap:github              # Recap yesterday',
      'sky recap:github 2026-02-08   # Recap a specific day',
      'sky recap:github --dry-run    # Render without writing',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { day, dryRun, noEditor, rel, noAutoTag, noAutoRel } = args

    if (!(await isCommandAvailable('gh'))) {
      return CommandResult.fail('gh CLI not found. Install GitHub CLI and run: gh auth login')
    }

    const window = await dayWindow(day)

    // Fetch wide, then clamp to the wake-to-wake window: the day really runs
    // wake to wake, not day:start to day:start.
    let repos
    try {
      repos = await fetchGithubActivity(
        { start: new Date(window.start.getTime() - WAKE_LOOKBACK_MS), end: window.end },
        { warn: (message) => output.log(colors.yellow(`⚠ ${message}`)) },
      )
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to fetch GitHub activity')
    }

    const instants = activityInstants(repos)
    const start = findWakeStart(instants, day, window.timezone, window.start) ?? window.start
    const cutoff = findWakeCutoff(
      instants.filter((instant) => instant >= start),
      day,
      window.timezone,
    )
    repos = clampActivity(repos, start, cutoff ?? window.end)

    if (repos.length === 0) {
      output.log(`No GitHub activity found for ${day.ymd}.`)
      return CommandResult.success({ repos: 0 })
    }

    const rendered = renderGithubRecap(repos, day, window.timezone)
    const firstClock = dayClock(rendered.first, day, window.timezone)
    const lastClock = dayClock(rendered.last, day, window.timezone)
    const when = firstClock === lastClock ? `${day.ymd} ${firstClock}` : `${day.ymd} ${firstClock} - ${lastClock}`

    const relList = rel
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    // Re-runs keep the human-curated slots from the existing file; the
    // classifiers fill only what is still empty.
    const curation = await readRecapCuration(day, APP)
    const curated = await enrichRecap(
      { app: APP, what: WHAT, body: rendered.body, kind: KIND },
      { rel: relList?.length ? relList : curation.rel, tags: curation.tags },
      { noAutoTag, noAutoRel, log: (line) => output.log(line) },
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
      return CommandResult.success({ repos: repos.length })
    }

    const file = await writeRecapFile({ day, app: APP, prefix: clockPrefix(firstClock), contents })
    output.log(`Recapped GitHub activity in ${repos.length} repo${repos.length === 1 ? '' : 's'} → ${file}`)

    // The recap is meant to be looked at — pop it into the editor.
    if (!noEditor) await openEditor([{ file }])

    return CommandResult.success({ file, repos: repos.length })
  }
}
