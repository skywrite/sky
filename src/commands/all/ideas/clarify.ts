import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runClarifierRound, runPromptJson } from '#commands/lib/interview.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { readTextFile } from '#shared/fs/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  statement: ArgOrFlag.string('The idea as best understood from the conversation', {
    short: 's',
    required: true,
  }),
  conversation: Flag.string('Relevant conversation excerpts: questions asked and answers given so far', {
    optional: true,
  }),
}

type Params = InferParams<typeof params>

type Result =
  | { status: 'unclear'; question: string; reason?: string }
  | { status: 'ready'; statement: string; title: string; slug: string; body: string; rel: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ideas:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/ideas-clarifier.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/ideas-format.prompt.md', import.meta.url).pathname

const formatSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  body: z.string().min(1),
  rel: z.array(z.string()).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class IdeasClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'ideas:clarify',
    description:
      'Judge whether an idea is well-formed and, once it is, return the formatted fields for ideas_create. Returns either a clarifying question to ask the user, or ready-to-write fields (title, slug, body, rel). Call again with refined inputs after each answer.',
    descriptionLong: [
      'Runs the idea clarifier and format prompts (the same ones behind',
      'ideas:new) over conversation-supplied inputs. Writes nothing — pair',
      'with ideas:create.',
    ],
    usage: ['sky ideas:clarify "An AI coach that reviews my daily journal"'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { statement, conversation } = args

    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(tasks, baseDir, statement)

    try {
      const round = await runClarifierRound({
        promptContent: await readTextFile(CLARIFIER_FILE),
        promptName: 'ideas-clarifier.prompt.md',
        input: {
          clarifier: {
            currentInput: statement,
            conversationHistory: conversation || undefined,
            notebookContext,
          },
        },
        clearKey: 'idea',
        errorSource: 'ideas:clarify',
        errorStage: 'clarify',
      })

      if (round.kind === 'question') {
        output.log(`Needs clarification: ${round.question}`)
        return CommandResult.success({ status: 'unclear', question: round.question, reason: round.reason })
      }

      const formatted = await runPromptJson({
        promptContent: await readTextFile(FORMAT_FILE),
        promptName: 'ideas-format.prompt.md',
        input: {
          idea: {
            description: round.statement,
            clarificationContext: conversation || undefined,
            notebookContext,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: formatSchema,
        errorSource: 'ideas:clarify',
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
        statement: round.statement,
        title: formatted.title,
        slug,
        body: formatted.body,
        rel,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Idea clarification failed')
    }
  }
}
