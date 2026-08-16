import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { isCommandAvailable } from '#lib/sys/command.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import { clockPrefix, dayClock } from './lib/clock.ts'
import dayWindow from './lib/dayWindow.ts'
import { fetchGithubActivity, renderGithubRecap } from './lib/github.ts'
import writeRecapFile from './lib/writeRecapFile.ts'

const APP = 'github'

const params = {
  day: dayNoFutureArg(),
  dryRun: Flag.bool('Render the recap without writing it', { default: false }),
  open: Flag.bool('Open the recap in the editor after writing', { short: 'o', default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
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
      'Uses the gh CLI for auth and API access. Re-running replaces the recap.',
    ],
    usage: [
      'sky recap:github              # Recap today',
      'sky recap:github 2026-02-08   # Recap a specific day',
      'sky recap:github --dry-run    # Render without writing',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { day, dryRun, open, rel } = args

    if (!(await isCommandAvailable('gh'))) {
      return CommandResult.fail('gh CLI not found. Install GitHub CLI and run: gh auth login')
    }

    const window = await dayWindow(day)

    let repos
    try {
      repos = await fetchGithubActivity(window)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to fetch GitHub activity')
    }

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

    const doc = RecapDocument.create({
      app: APP,
      what: 'Code - GitHub',
      when,
      rel: relList?.length ? relList : undefined,
      body: rendered.body,
    })
    const contents = doc.toMarkdown()

    if (dryRun) {
      output.log(contents)
      return CommandResult.success({ repos: repos.length })
    }

    const file = await writeRecapFile({ day, app: APP, prefix: clockPrefix(firstClock), contents })
    output.log(`Recapped GitHub activity in ${repos.length} repo${repos.length === 1 ? '' : 's'} → ${file}`)

    if (open) openEditor([{ file }])

    return CommandResult.success({ file, repos: repos.length })
  }
}
