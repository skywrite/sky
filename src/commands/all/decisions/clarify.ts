import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runClarifierRound, runPromptJson } from '#commands/lib/interview.ts'
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
  conversation: Flag.string('Relevant conversation excerpts: questions asked and answers given so far', {
    optional: true,
  }),
}

type Params = InferParams<typeof params>

type Result =
  | { status: 'unclear'; question: string; reason?: string }
  | {
      status: 'ready'
      statement: string
      title: string
      slug: string
      target: string | null
      contextSummary: string
      outcomesSummary: string
      rel: string[]
    }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/decisions-clarifier.prompt.md', import.meta.url).pathname
const OUTCOMES_FILE = new URL('./prompts/decisions-outcomes.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/decisions-new.prompt.md', import.meta.url).pathname

const formatSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  target: z.string().nullish(),
  contextSummary: z.string(),
  outcomesSummary: z.string(),
  rel: z.array(z.string()).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class DecisionsClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:clarify',
    description:
      'Judge whether a decision is well-formed and, once it is, return the formatted fields for decisions_create. Returns either a clarifying question to ask the user, or ready-to-write fields. Call again with refined inputs after each answer. Requires outcomes and a timeframe before it will format.',
    descriptionLong: [
      'Runs the decision clarifier, outcomes clarifier, and format prompts',
      '(the same ones behind decisions:new) over conversation-supplied inputs.',
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

    const unclear = (question: string, reason?: string): CommandResult<Result> => {
      output.log(`Needs clarification: ${question}`)
      return CommandResult.success({ status: 'unclear', question, reason })
    }

    try {
      // 1. Is the decision statement well-formed?
      const decisionRound = await runClarifierRound({
        promptContent: await readTextFile(CLARIFIER_FILE),
        promptName: 'decisions-clarifier.prompt.md',
        input: {
          clarifier: {
            currentInput: statement,
            conversationHistory: conversation || undefined,
            notebookContext,
          },
        },
        clearKey: 'decision',
        errorSource: 'decisions:clarify',
        errorStage: 'clarify',
      })

      if (decisionRound.kind === 'question') {
        return unclear(decisionRound.question, decisionRound.reason)
      }

      // 2. The interview requires outcomes and a timeframe before formatting —
      // the conversation is the transport for these questions
      if (!outcomes?.trim()) {
        return unclear(
          'What does a good outcome look like once this is decided?',
          'Desired outcomes are required before the decision can be formatted.',
        )
      }
      if (!timeframe?.trim()) {
        return unclear(
          'What is the timeframe for making this decision?',
          'A timeframe is required before the decision can be formatted.',
        )
      }

      // 3. Are the outcomes well-formed?
      const outcomesRound = await runClarifierRound({
        promptContent: await readTextFile(OUTCOMES_FILE),
        promptName: 'decisions-outcomes.prompt.md',
        input: {
          outcomes: {
            decision: decisionRound.statement,
            timeframe,
            currentInput: outcomes,
            conversationHistory: conversation || undefined,
            notebookContext,
          },
        },
        clearKey: 'outcomes',
        errorSource: 'decisions:clarify',
        errorStage: 'outcomes',
      })

      if (outcomesRound.kind === 'question') {
        return unclear(outcomesRound.question, outcomesRound.reason)
      }

      // 4. Format into document fields
      const now = await fetchNow()
      const formatted = await runPromptJson({
        promptContent: await readTextFile(FORMAT_FILE),
        promptName: 'decisions-new.prompt.md',
        input: {
          context: {
            notebookDate: now.plainDateTime.date,
            systemDate: context.systemNow.date,
            notebookTimezone: now.timezone,
            systemTimezone: context.systemNow.timezone,
          },
          decision: {
            description: decisionRound.statement,
            timeframe,
            decisionConversation: conversation || undefined,
            desiredOutcomes: outcomesRound.statement,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: formatSchema,
        errorSource: 'decisions:clarify',
        errorStage: 'format',
      })

      const slug =
        slugify(formatted.slug, { suggestedLength: 25, preserveCase: true }) ||
        slugify(formatted.title, { suggestedLength: 25, preserveCase: true })

      // Only rel values picked from the offered candidate list survive
      const rel = (formatted.rel ?? []).filter((r) => relCandidates.includes(r))

      output.log(`Ready: "${formatted.title}" (${slug})`)

      return CommandResult.success({
        status: 'ready',
        statement: decisionRound.statement,
        title: formatted.title,
        slug,
        target: formatted.target ?? null,
        contextSummary: formatted.contextSummary,
        outcomesSummary: formatted.outcomesSummary,
        rel,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Decision clarification failed')
    }
  }
}
