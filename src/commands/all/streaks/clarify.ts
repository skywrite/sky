import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runClarifierRound, runPromptJson } from '#commands/lib/interview.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { readTextFile } from '#shared/fs/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  habit: ArgOrFlag.string('The habit as best understood from the conversation', {
    short: 'i',
    required: true,
  }),
  details: Flag.string('Detailed rules for the streak, if the user provided any (kept verbatim)', {
    optional: true,
  }),
  schedule: Flag.string('Schedule: "daily" or "weekdays" — ask the user if unstated', {
    optional: true,
  }),
  conversation: Flag.string('Relevant conversation excerpts: questions asked and answers given so far', {
    optional: true,
  }),
}

type Params = InferParams<typeof params>

interface ReviewQuestion {
  question: string
  why: string
}

type Result =
  | { status: 'unclear'; question: string; reason?: string }
  | {
      status: 'ready'
      habit: string
      title: string
      slug: string
      why: string
      rel: string[]
      /** Loophole-hunting questions about the detailed rules — ask the user, fold answers into details, call again */
      reviewQuestions: ReviewQuestion[]
    }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/streaks-clarifier.prompt.md', import.meta.url).pathname
const REVIEW_FILE = new URL('./prompts/streaks-review.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/streaks-format.prompt.md', import.meta.url).pathname

const reviewSchema = z.union([
  z.object({ status: z.literal('tight'), note: z.string().optional() }),
  z.object({
    status: z.literal('questions'),
    questions: z.array(z.object({ question: z.string().min(1), why: z.string() })),
  }),
])

const formatSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  why: z.string().min(1),
  rel: z.array(z.string()).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class StreaksClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:clarify',
    description:
      'Judge whether a habit is streak-worthy (binary, small, controllable) and, once it is, return the formatted fields for streaks_create. Returns either a clarifying question, or ready fields plus reviewQuestions that probe the detailed rules for loopholes — relay those, fold answers into details, and call again.',
    descriptionLong: [
      'Runs the streak clarifier, rules review, and format prompts (the same',
      'ones behind streaks:new) over conversation-supplied inputs. Writes',
      'nothing — pair with streaks:create.',
    ],
    usage: ['sky streaks:clarify "Eat clean - no sugar, no seed oils" --schedule daily'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { habit, details, conversation } = args
    const schedule = args.schedule === 'weekdays' ? 'weekdays' : 'daily'

    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(tasks, baseDir, habit)

    try {
      const round = await runClarifierRound({
        promptContent: await readTextFile(CLARIFIER_FILE),
        promptName: 'streaks-clarifier.prompt.md',
        input: {
          clarifier: {
            currentInput: habit,
            conversationHistory: conversation || undefined,
            notebookContext,
          },
        },
        clearKey: 'habit',
        errorSource: 'streaks:clarify',
        errorStage: 'clarify',
      })

      if (round.kind === 'question') {
        output.log(`Needs clarification: ${round.question}`)
        return CommandResult.success({ status: 'unclear', question: round.question, reason: round.reason })
      }

      // Review the detailed rules for loopholes. Failures degrade to no
      // questions — the review sharpens rules, it must never block creation.
      let reviewQuestions: ReviewQuestion[] = []
      if (details?.trim()) {
        try {
          const review = await runPromptJson({
            promptContent: await readTextFile(REVIEW_FILE),
            promptName: 'streaks-review.prompt.md',
            input: { review: { habit: round.statement, schedule, details } },
            schema: reviewSchema,
            errorSource: 'streaks:clarify',
            errorStage: 'review',
          })
          if (review.status === 'questions') {
            reviewQuestions = review.questions.slice(0, 3)
          }
        } catch (err) {
          await logAIError({ source: 'streaks:clarify', stage: 'review', message: (err as Error).message })
        }
      }

      const formatted = await runPromptJson({
        promptContent: await readTextFile(FORMAT_FILE),
        promptName: 'streaks-format.prompt.md',
        input: {
          streak: {
            description: round.statement,
            schedule,
            details,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: formatSchema,
        errorSource: 'streaks:clarify',
        errorStage: 'format',
      })

      const slug = slugify(formatted.slug, { suggestedLength: 20 }) || slugify(formatted.title, { suggestedLength: 20 })

      // Only rel values picked from the offered candidate list survive
      const rel = (formatted.rel ?? []).filter((r) => relCandidates.includes(r))

      output.log(`Ready: "${formatted.title}" (${slug})`)

      return CommandResult.success({
        status: 'ready',
        habit: round.statement,
        title: formatted.title,
        slug,
        why: formatted.why,
        rel,
        reviewQuestions,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Streak clarification failed')
    }
  }
}
