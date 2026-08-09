import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runPromptJson } from '#commands/lib/interview.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  statement: ArgOrFlag.string('The decision statement as best understood from the conversation', {
    short: 's',
    required: true,
  }),
  outcomes: Flag.string('Desired outcomes, if the conversation established them', { optional: true }),
  timeframe: Flag.string('Timeframe for deciding, if stated (free text, e.g. "end of month")', {
    optional: true,
  }),
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
  /** The call as made — non-null means the decision is already settled and will land resolved */
  decision: string | null
  target: string | null
  context: string
  desiredOutcomes: string
  rel: string[]
  openQuestions: OpenQuestion[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DRAFT_FILE = new URL('./prompts/decisions-draft.prompt.md', import.meta.url).pathname

const openQuestionSchema = z.object({
  question: z.string().min(1),
  why: z.string().optional(),
  proposed: z.string().min(1),
})

const draftSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  decision: z.string().nullish(),
  target: z.string().nullish(),
  contextSummary: z.string().min(1),
  outcomesSummary: z.string().min(1),
  rel: z.array(z.string()).nullish(),
  openQuestions: z.array(openQuestionSchema).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class DecisionsClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:clarify',
    description:
      'Draft a complete decision document from the conversation in one call. Returns create-ready fields (matching decisions_create params) plus openQuestions, each carrying a proposed answer. Detects whether the conversation already made the call: a non-null `decision` field means it lands resolved, not pending. Writes nothing.',
    descriptionLong: [
      'Runs the decisions-draft prompt over conversation-supplied inputs and',
      'returns a full draft plus open questions with proposed defaults.',
      'Writes nothing — pair with decisions:create.',
    ],
    usage: ['sky decisions:clarify "Whether to hire Jane as CFO" --outcomes "..." --timeframe "this month"'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { statement, outcomes, timeframe, conversation } = args

    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(tasks, baseDir, statement)

    try {
      const now = await fetchNow()
      const draft = await runPromptJson({
        promptContent: await readTextFile(DRAFT_FILE),
        promptName: 'decisions-draft.prompt.md',
        input: {
          context: { notebookDate: now.plainDateTime.date },
          decision: {
            statement,
            outcomes: outcomes || undefined,
            timeframe: timeframe || undefined,
            conversation: conversation || undefined,
            notebookContext,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: draftSchema,
        errorSource: 'decisions:clarify',
        errorStage: 'draft',
      })

      const name =
        slugify(draft.slug, { suggestedLength: 25, preserveCase: true }) ||
        slugify(draft.title, { suggestedLength: 25, preserveCase: true })

      // Only rel values picked from the offered candidate list survive
      const rel = (draft.rel ?? []).filter((r) => relCandidates.includes(r))
      const openQuestions = draft.openQuestions ?? []

      // A made call has no decide-by date, whatever the model returned
      const decision = draft.decision?.trim() || null

      output.log(
        `Draft ready: "${draft.title}" (${name}) — ${decision ? 'decided' : 'pending'}, ${openQuestions.length} open question(s)`,
      )

      return CommandResult.success({
        title: draft.title,
        name,
        decision,
        target: decision ? null : (draft.target ?? null),
        context: draft.contextSummary,
        desiredOutcomes: draft.outcomesSummary,
        rel,
        openQuestions,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Decision drafting failed')
    }
  }
}
