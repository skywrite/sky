import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runPromptJson } from '#commands/lib/interview.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  habit: ArgOrFlag.string('The habit as best understood from the conversation', {
    short: 'i',
    required: true,
  }),
  details: Flag.string('Rules the user already stated, kept verbatim inside the drafted rule doc', {
    optional: true,
  }),
  schedule: Flag.string('Schedule if discussed: "daily" or "weekdays"', { optional: true }),
  start: Flag.string('Start day if discussed, "YYYY-MM-DD"', { optional: true }),
  conversation: Flag.string('Relevant conversation excerpts: what was discussed, answered, and settled', {
    optional: true,
  }),
}

type Params = InferParams<typeof params>

interface OpenQuestion {
  question: string
  why?: string
  proposed: string
}

type Result = {
  title: string
  name: string
  schedule: string
  start: string | null
  why: string
  details: string
  rel: string[]
  openQuestions: OpenQuestion[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DRAFT_FILE = new URL('./prompts/streaks-draft.prompt.md', import.meta.url).pathname

const openQuestionSchema = z.object({
  question: z.string().min(1),
  why: z.string().optional(),
  proposed: z.string().min(1),
})

const draftSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  why: z.string().min(1),
  schedule: z.enum(['daily', 'weekdays']),
  start: z.string().nullish(),
  details: z.string().min(1),
  rel: z.array(z.string()).nullish(),
  openQuestions: z.array(openQuestionSchema).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class StreaksClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:clarify',
    description:
      'Call only when the user has explicitly asked to create/capture a streak — a question about what the streak should be is a design conversation, answered in chat. Draft a complete streak rule document from the conversation in one call — including the full detailed rules — plus openQuestions that close loopholes, each carrying a proposed tightening. Show the user the draft and the questions with their proposals — unanswered questions mean the proposals stand. Fields match streaks_create params. Writes nothing.',
    descriptionLong: [
      'Runs the streaks-draft prompt over conversation-supplied inputs and',
      'returns a full rule-doc draft plus loophole questions with proposed',
      'defaults. Writes nothing — pair with streaks:create.',
    ],
    usage: ['sky streaks:clarify "Eat clean - no sugar, no seed oils" --schedule daily'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { habit, details, schedule, start, conversation } = args

    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(
      tasks,
      baseDir,
      habit,
      context.notebookNow.plainDateTime.plainDate,
    )

    try {
      const now = await fetchNow()
      const draft = await runPromptJson({
        promptContent: await readPromptFile(DRAFT_FILE),
        promptName: 'streaks-draft.prompt.md',
        input: {
          context: { notebookDate: now.plainDateTime.date },
          streak: {
            habit,
            details: details || undefined,
            schedule: schedule || undefined,
            start: start || undefined,
            conversation: conversation || undefined,
            notebookContext,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: draftSchema,
        errorSource: 'streaks:clarify',
        errorStage: 'draft',
      })

      const name = slugify(draft.slug, { suggestedLength: 20 }) || slugify(draft.title, { suggestedLength: 20 })

      // Only rel values picked from the offered candidate list survive
      const rel = (draft.rel ?? []).filter((r) => relCandidates.includes(r))
      const openQuestions = draft.openQuestions ?? []

      output.log(`Draft ready: "${draft.title}" (${name}) — ${openQuestions.length} open question(s)`)

      return CommandResult.success({
        title: draft.title,
        name,
        schedule: draft.schedule,
        start: draft.start ?? null,
        why: draft.why,
        details: draft.details,
        rel,
        openQuestions,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Streak drafting failed')
    }
  }
}
