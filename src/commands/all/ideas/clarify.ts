import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { gatherNotebookContext, runPromptJson } from '#commands/lib/interview.ts'
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
  body: string
  rel: string[]
  openQuestions: OpenQuestion[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ideas:clarify': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DRAFT_FILE = new URL('./prompts/ideas-draft.prompt.md', import.meta.url).pathname

const openQuestionSchema = z.object({
  question: z.string().min(1),
  why: z.string().optional(),
  proposed: z.string().min(1),
})

const draftSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  body: z.string().min(1),
  rel: z.array(z.string()).nullish(),
  openQuestions: z.array(openQuestionSchema).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: false })
export default class IdeasClarifyTask extends Command {
  static override description: CommandDescription = {
    name: 'ideas:clarify',
    description:
      'Draft a complete idea document from the conversation in one call. Returns create-ready fields (matching ideas_create params) plus openQuestions, each carrying a proposed answer. Show the user the draft and the questions with their proposals — unanswered questions mean the proposals stand. Writes nothing.',
    descriptionLong: [
      'Runs the ideas-draft prompt over conversation-supplied inputs and',
      'returns a full draft plus open questions with proposed defaults.',
      'Writes nothing — pair with ideas:create.',
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
      const draft = await runPromptJson({
        promptContent: await readTextFile(DRAFT_FILE),
        promptName: 'ideas-draft.prompt.md',
        input: {
          idea: {
            statement,
            conversation: conversation || undefined,
            notebookContext,
            relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
          },
        },
        schema: draftSchema,
        errorSource: 'ideas:clarify',
        errorStage: 'draft',
      })

      const name =
        slugify(draft.slug, { suggestedLength: 25, preserveCase: true }) ||
        slugify(draft.title, { suggestedLength: 25, preserveCase: true })

      // Only rel values picked from the offered candidate list survive
      const rel = (draft.rel ?? []).filter((r) => relCandidates.includes(r))
      const openQuestions = draft.openQuestions ?? []

      output.log(`Draft ready: "${draft.title}" (${name}) — ${openQuestions.length} open question(s)`)

      return CommandResult.success({
        title: draft.title,
        name,
        body: draft.body,
        rel,
        openQuestions,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Idea drafting failed')
    }
  }
}
