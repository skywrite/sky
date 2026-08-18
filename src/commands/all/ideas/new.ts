import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { z } from 'zod'
import { gatherNotebookContext, runClarifierLoop } from '#commands/lib/interview.ts'
import { categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { SlugCollisionError, writeIdea } from './lib/write.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Flag.string('Override the generated slug/name', {
    short: 'n',
    optional: true,
  }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ideas:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/ideas-clarifier.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/ideas-format.prompt.md', import.meta.url).pathname

const MAX_CLARIFICATION_ROUNDS = 3

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// The AI response is validated against the prompt contract so a malformed
// reply degrades loudly instead of writing a half-empty document.
const formatSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  body: z.string().min(1),
  rel: z.array(z.string()).nullish(),
})

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class IdeasNewTask extends Command {
  static override description: CommandDescription = {
    name: 'ideas:new',
    description: 'Create a new idea with AI-assisted clarification.',
    descriptionLong: [
      'Creates a new Idea document in draft status.',
      'AI asks clarifying questions to flesh out the idea,',
      'then formats it into a well-written document.',
    ],
    usage: [
      'sky ideas:new                    # Interactive AI-guided flow',
      'sky ideas:new --name my-idea     # Override slug name',
      'sky ideas:new --category Professional  # Set day item category',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { name: overrideName, category } = args

    p.intro(colors.bold(colors.cyan('New Idea')))

    const spinner = p.spinner()

    // Step 1: Gather initial idea description
    const initialDescription = await p.text({
      message: 'What is the idea?\n',
      placeholder: 'e.g., "AI-powered daily review that suggests focus areas"',
      validate: (value) => {
        if (!value.trim()) return 'Please describe the idea'
      },
    })

    if (p.isCancel(initialDescription)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 2: Gather notebook context
    spinner.start('Gathering context...')
    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(
      tasks,
      baseDir,
      initialDescription as string,
      context.notebookNow.plainDateTime.plainDate,
    )
    spinner.stop(notebookContext ? colors.dim('Context loaded') : colors.dim('No additional context found'))

    // Step 3: Clarify the idea until it's well-formed
    const ideaResult = await runClarifierLoop(initialDescription as string, {
      promptFile: CLARIFIER_FILE,
      promptName: 'ideas-clarifier.prompt.md',
      buildInput: (currentInput, conversationHistory) => ({
        clarifier: {
          currentInput,
          conversationHistory: conversationHistory || undefined,
          notebookContext,
        },
      }),
      clearKey: 'idea',
      labels: {
        thinking: 'Thinking about your idea...',
        clear: 'Idea is clear',
        confirm: 'Idea:',
        edit: 'How would you describe the idea?',
      },
      maxRounds: MAX_CLARIFICATION_ROUNDS,
      errorSource: 'ideas:new',
      errorStage: 'clarify',
      spinner,
    })

    if (ideaResult === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 4: Optional tags
    const tagsInput = await p.text({
      message: 'Tags (comma-separated, or press Enter to skip)\n',
      placeholder: 'e.g., ai, notebook, productivity',
    })

    if (p.isCancel(tagsInput)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    const tags = (tagsInput as string)?.trim() ? TagSet.fromArray((tagsInput as string).split(',')) : undefined

    // Step 5: Format the idea with AI
    spinner.start('Formatting your idea...')

    const formatContent = await readTextFile(FORMAT_FILE)

    const formatInput: RenderInput = {
      idea: {
        description: ideaResult.statement,
        clarificationContext: ideaResult.conversation || undefined,
        notebookContext,
        relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'ideas-format.prompt.md', formatInput)

    let aiResponse: z.infer<typeof formatSchema>

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedFormat,
      })

      aiResponse = formatSchema.parse(extractJson(result.text))
      spinner.stop('Idea formatted')
    } catch (err) {
      spinner.stop('Failed to format idea')
      await logAIError({ source: 'ideas:new', stage: 'format', message: (err as Error).message })
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format idea with AI')
    }

    // Step 6: Determine final name/slug — every source passes through slugify
    // so an AI- or user-supplied value can't smuggle path separators into the
    // filename
    const finalName =
      (overrideName ? slugify(overrideName, { preserveCase: true }) : '') ||
      slugify(aiResponse.slug, { suggestedLength: 25, preserveCase: true }) ||
      slugify(ideaResult.statement, { suggestedLength: 25, preserveCase: true })

    if (!finalName) {
      return CommandResult.fail('Could not derive a usable slug — rerun with --name')
    }

    // Only rel values the AI picked from the offered candidate list survive
    const rel = (aiResponse.rel ?? []).filter((r) => relCandidates.includes(r))

    // Step 7: Write the document + day item
    const now = await fetchNow()

    let written
    try {
      written = await writeIdea({
        name: finalName,
        title: aiResponse.title,
        body: aiResponse.body,
        tags,
        rel,
        now,
        category,
      })
    } catch (err) {
      if (err instanceof SlugCollisionError) {
        return CommandResult.fail(`${err.message} — rerun with --name to pick a different slug.`)
      }
      throw err
    }

    output.log(colors.green(`\nCreated idea: ${written.file}`))

    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    } else {
      output.log(colors.gray(`Added to ${category}: ${written.dayItem}`))
    }

    // Step 8: Open in editor
    try {
      openEditor([{ file: written.file, line: written.markdown.split('\n').length }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Idea "${finalName}" created successfully`))

    return CommandResult.success({ file: written.file, name: finalName })
  }
}
