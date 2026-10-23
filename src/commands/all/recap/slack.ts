import { generateText } from 'ai'
import { hasNotebookDay } from '#commands/all/slack/pull/lib/dayView.ts'
import { aiEffortFlag } from '#commands/lib/aiParams.ts'
import { Command, CommandResult, dayYesterdayArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_SLACK_DAYS } from '#config'
import enrichRecap from '#lib/notebook/enrich/enrichRecap.ts'
import readRecapCuration from '#lib/notebook/recap/readRecapCuration.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile, getProfile, type ModelProfile } from '#shared/ai/models.ts'
import { ratioFor } from '#shared/ai/tokenRatio.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { RecapDocument } from '#shared/models/mod.ts'
import { actionKindRel, readDay } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import type { EffortOverride } from '#universal/ai/effort.ts'
import { fitBudget, modelTokens } from '#universal/ai/readingBudget.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { clockPrefix } from './lib/clock.ts'
import gatherSlackDay, { dropCapturedThreads } from './lib/slackDay.ts'
import {
  dueSlackDay,
  readDayCaptures,
  renderSlackInput,
  SLACK_APP,
  SLACK_WHAT,
  slackRecapHeader,
  slackRecapWhen,
} from './lib/slackRecap.ts'
import writeRecapFile, { findRecapFile } from './lib/writeRecapFile.ts'

const PROMPT_FILE = new URL('./prompts/slack.prompt.md', import.meta.url).pathname

// What the tag and rel classifiers are told they are labeling.
const KIND = 'daily Slack channel recap'

// The digest reads a whole day of channels at once and the day summary
// reads the digest: the reasoning model at high effort here, and the
// summary keeps its own model.
const DEFAULT_PROFILE = 'default-opus-5.5'
const DEFAULT_EFFORT: EffortOverride = 'high'

// A day's channels and the earlier threads they reply to, in the model's
// tokens; a profile with a smaller window takes the highest stop that fits.
const READING_BUDGET_TOKENS = 750_000

// How many days back --when-due looks for a day owed its recap.
const DUE_LOOKBACK_DAYS = 3

const params = {
  day: dayYesterdayArg(),
  effort: aiEffortFlag(),
  model: Flag.string('Model profile to use', { long: 'ai-model', short: 'm', default: () => DEFAULT_PROFILE }),
  dryRun: Flag.bool('Print the prompts without calling the model or writing', { default: false }),
  noEditor: Flag.bool('Skip opening the recap in the editor', { default: false }),
  rel: Flag.string('Related entities, comma-separated (e.g. projects/atlas)', { optional: true }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-recaps tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  whenDue: Flag.bool('Only a recent day whose next day has started and that has no recap yet; nothing otherwise', {
    hidden: true,
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = {
  outcome: 'recapped' | 'nothing'
  day: string
  file?: string
  channels: number
  messages: number
  threads: number
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'recap:slack': { params: Params; result: Result }
  }
}

export default class RecapSlackTask extends Command {
  static override description: CommandDescription = {
    name: 'recap:slack',
    description: `Recap the day's Slack channels into ${actionKindRel('recap')}/`,
    descriptionLong: [
      'Digests every Slack channel you are a member of, for one notebook day,',
      'into one recap doc: what moved per channel with message counts, the',
      'quiet channels rolled up, what was asked of you, and where each matter',
      'stood, every line tagged with its channel and time.',
      '',
      'The day is assembled from the channel cache sky slack:pull keeps, by',
      'notebook day (the rule captures file by), with the earlier part of',
      'every thread replied to that day; a thread already captured in the',
      'day is left to the capture. The recap is the Slack input of',
      'summary:day, which writes it first when a day lacks one; the service',
      "writes yesterday's once today has started.",
      '',
      'The day defaults to yesterday. Re-running replaces the recap and keeps',
      'its curated tags and rel.',
    ],
    usage: [
      'sky recap:slack              # Recap yesterday',
      'sky recap:slack 2026-02-08   # Recap a specific day',
      'sky recap:slack --dry-run    # Print the prompts without calling the model',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const timeDir = <string>config.DIR_TIME
    const root = DIR_STATE_SLACK_DAYS

    // A bad -m should fail before any reading happens.
    let profile: ModelProfile
    try {
      profile = getProfile(args.model)
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }

    const nothing = (day: PlainDate): CommandResult<Result> =>
      CommandResult.success({ outcome: 'nothing', day: day.ymd, channels: 0, messages: 0, threads: 0 })

    let day = args.day
    if (args.whenDue) {
      const candidates = Array.from({ length: DUE_LOOKBACK_DAYS }, (_, back) => args.day.addDays(-back))
      const due = await dueSlackDay({
        candidates,
        started: (date) => hasStarted(date, timeDir),
        hasRecap: async (date) => (await findRecapFile(date, SLACK_APP, timeDir)) !== null,
        hasMessages: (date) => hasNotebookDay(root, date.ymd),
      })
      if (!due) return nothing(args.day)
      day = due
    }

    output.log(`Recapping Slack channels for ${day.ymd}...`)
    const docs = await gatherSlackDay({ root, day: day.ymd })
    if (docs.channels.length === 0 || !docs.span) {
      output.log(`No Slack channel messages for ${day.ymd}.`)
      return nothing(day)
    }
    const threads = dropCapturedThreads(docs.threads, await readDayCaptures(timeDir, day))
    const input = renderSlackInput({
      day,
      root,
      channels: docs.channels,
      threads: threads.kept,
      messages: docs.messages,
    })
    const instructions = await this.loadInstructions()

    // The budget and the count shown are the model's tokens: the text is
    // measured at four characters a token and restated through the ratio
    // learned for the model.
    const ratio = ratioFor(profile.model)
    const budget = fitBudget(READING_BUDGET_TOKENS, profile.contextWindow)
    const tokens = modelTokens(estimateTokens(input), ratio)
    output.log(
      `Slack: ${docs.channels.length} channel(s), ${docs.messages} message(s), ${threads.kept.length} earlier thread(s), ${threads.captured.length} captured in the day`,
    )
    output.log(`Input: ~${Math.round(tokens / 1000)}k tokens (budget ${Math.round(budget / 1000)}k)`)

    if (args.dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(instructions)
      output.log('\n=== USER PROMPT ===')
      output.log(input)
      return nothing(day)
    }
    if (tokens > budget) {
      return CommandResult.fail(
        `The day's Slack is ~${Math.round(tokens / 1000)}k tokens, over the ${Math.round(budget / 1000)}k budget. ` +
          'Refusing to recap a partial day.',
      )
    }

    output.log('Calling the model...')
    let body: string
    let usage = ''
    try {
      const result = await generateText({
        ...aiModelByProfile(args.model, { effort: args.effort ?? DEFAULT_EFFORT }),
        instructions,
        prompt: input,
      })
      body = result.text.trim()
      const { inputTokens, outputTokens } = result.usage
      if (inputTokens !== undefined && outputTokens !== undefined) usage = `${inputTokens} in, ${outputTokens} out`
    } catch (err) {
      await logAIError({
        source: 'recap:slack',
        stage: 'generate',
        message: err instanceof Error ? err.message : String(err),
      })
      return CommandResult.error(err as Error, 'Failed to call the model')
    }

    const { when, first } = slackRecapWhen(day, docs.span)
    const relList = args.rel
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    // Re-runs keep the human-curated slots from the existing file; the
    // classifiers fill only what is still empty.
    const curation = await readRecapCuration(day, SLACK_APP, timeDir)
    const curated = await enrichRecap(
      { app: SLACK_APP, what: SLACK_WHAT, body, kind: KIND },
      { rel: relList?.length ? relList : curation.rel, tags: curation.tags },
      { noAutoTag: args.noAutoTag, noAutoRel: args.noAutoRel, log: (line) => output.log(line) },
    )

    const doc = RecapDocument.create({
      app: SLACK_APP,
      what: SLACK_WHAT,
      when,
      rel: curated.rel,
      tags: curated.tags,
      body: `${slackRecapHeader(day, docs, threads.kept.length)}\n${body}\n`,
    })
    // The model and what it read, stamped the way the day summary stamps its own.
    const contents = new Document(
      { ...doc.yaml, model: profile.model, ...(usage ? { usage } : {}) },
      doc.markdown,
    ).toMarkdown()
    const file = await writeRecapFile({ day, app: SLACK_APP, prefix: clockPrefix(first), contents, timeDir })
    output.log(`Recapped ${docs.channels.length} Slack channel(s) → ${file}`)

    if (!args.noEditor) await openEditor([{ file }])

    return CommandResult.success({
      outcome: 'recapped',
      day: day.ymd,
      file,
      channels: docs.channels.length,
      messages: docs.messages,
      threads: threads.kept.length,
    })
  }

  private async loadInstructions(): Promise<string> {
    const content = await readPromptFile(PROMPT_FILE)
    return renderPromptFile(content, 'slack.prompt.md').output
  }
}

/** Whether the notebook day has a start stamp: once the next day has one, a day's messages are all in. */
async function hasStarted(day: PlainDate, timeDir: string): Promise<boolean> {
  try {
    return (await readDay(day, timeDir)).started !== undefined
  } catch {
    return false
  }
}
