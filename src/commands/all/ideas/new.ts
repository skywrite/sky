import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_IDEAS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import IdeaDocument from '#shared/models/Idea/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Flag.string('Override the generated slug/name', {
    short: 'n',
    optional: true,
  }),
  category: Flag.string('Category for day item: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${val} Complete`,
    default: () => 'Professional Complete',
  }),
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

type ClarifierResult =
  | { status: 'clear'; idea: string; summary: string }
  | { status: 'unclear'; question: string; reason: string }

/**
 * Run the idea clarifier to ensure the idea is well-formed.
 * Returns the clarified idea statement, or null if user cancels.
 */
async function clarifyIdea(
  initialInput: string,
  spinner: ReturnType<typeof p.spinner>,
  notebookContext?: string,
): Promise<string | null> {
  const clarifierContent = await readTextFile(CLARIFIER_FILE)
  let currentInput = initialInput
  let conversationHistory = ''

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Thinking about your idea...')

    const clarifierInput: RenderInput = {
      clarifier: {
        currentInput,
        conversationHistory: conversationHistory || undefined,
        notebookContext,
      },
    }

    const { output: renderedClarifier } = renderPromptFile(
      clarifierContent,
      'ideas-clarifier.prompt.md',
      clarifierInput,
    )

    let clarifierResult: ClarifierResult

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedClarifier,
      })

      clarifierResult = extractJson<typeof clarifierResult>(result.text)
    } catch {
      spinner.stop('Clarification failed')
      return currentInput
    }

    if (clarifierResult.status === 'clear') {
      spinner.stop(colors.green('Idea is clear'))

      const confirmed = await p.confirm({
        message: `${colors.bold('Idea:')} ${clarifierResult.idea}\n\n  ${colors.dim(
          clarifierResult.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return clarifierResult.idea
      }

      const edited = await p.text({
        message: 'How would you describe the idea?\n',
        initialValue: clarifierResult.idea,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // Idea is unclear - ask the clarifying question
    spinner.stop(colors.dim(clarifierResult.reason))

    const answer = await p.text({
      message: `${clarifierResult.question}\n`,
      placeholder: 'Your answer...',
    })

    if (p.isCancel(answer)) {
      return null
    }

    conversationHistory += `\nAI asked: "${clarifierResult.question}"\nUser answered: "${answer}"`
    currentInput = `${currentInput}\n\nClarification: ${answer}`
  }

  // Max rounds reached - proceed with what we have
  return currentInput
}

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

    // Step 2: Gather notebook context via ai:context:files
    spinner.start('Gathering context...')

    let notebookContext: string | undefined
    const baseDir = config.DIR_BASE as string

    try {
      const filesResult = await tasks.run<{ paths: string[] }>('ai:context:files', {
        _: ['ai:context:files', initialDescription as string],
        since: '90d',
      })

      if (filesResult.status === 'success' && filesResult.data?.paths?.length) {
        const store = await MarkdownStore.buildFromAll()

        const docs: Array<{ doc: Document; path: string }> = []
        for (const filePath of filesResult.data.paths) {
          try {
            const content = await readTextFile(filePath)
            const doc = Document.fromMarkdown(content)
            docs.push({ doc, path: filePath })
          } catch {
            // Skip unreadable files
          }
        }

        if (docs.length > 0) {
          const collection = DomainCollection.fromDocuments(docs, store)
          notebookContext = collection.toMarkdown({ relativeTo: baseDir, delimited: true })
        }
      }
    } catch {
      // Context gathering failed — continue without it
    }

    spinner.stop(notebookContext ? colors.dim('Context loaded') : colors.dim('No additional context found'))

    // Step 3: Clarify the idea until it's well-formed
    const clarifiedIdea = await clarifyIdea(initialDescription as string, spinner, notebookContext)

    if (clarifiedIdea === null) {
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

    const tags = (tagsInput as string)?.trim()
      ? (tagsInput as string)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .join(', ')
      : undefined

    // Step 5: Format the idea with AI
    spinner.start('Formatting your idea...')

    const formatContent = await readTextFile(FORMAT_FILE)

    const formatInput: RenderInput = {
      idea: {
        description: clarifiedIdea,
        clarificationContext: clarifiedIdea !== (initialDescription as string) ? clarifiedIdea : undefined,
        notebookContext,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'ideas-format.prompt.md', formatInput)

    let aiResponse: { title: string; slug: string; body: string }

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedFormat,
      })

      aiResponse = extractJson<typeof aiResponse>(result.text)
      spinner.stop('Idea formatted')
    } catch (err) {
      spinner.stop('Failed to format idea')
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format idea with AI')
    }

    // Step 6: Determine final name/slug
    const finalName =
      overrideName ?? aiResponse.slug ?? slugify(clarifiedIdea, { suggestedLength: 25, preserveCase: true })

    // Step 7: Create the Idea document
    const idea = IdeaDocument.create({
      name: finalName,
      title: aiResponse.title,
      body: aiResponse.body,
      tags,
    })

    // Step 8: Write to file in draft/{month}/
    const now = await fetchNow()
    const year = now.plainDateTime.plainDate.year
    const month = String(now.plainDateTime.plainDate.month).padStart(2, '0')
    const ideaFullPath = path.join(DIR_IDEAS, String(year), 'draft', month, `${finalName}.md`)

    const markdownContent = idea.toMarkdown()
    await outputFile(ideaFullPath, markdownContent)

    output.log(colors.green(`\nCreated idea: ${ideaFullPath}`))

    // Step 9: Add day item
    const entryTime = now.plainDateTime.time
    const dayItem = `${entryTime} > ideas/${finalName} -> New idea | ${aiResponse.title}`

    try {
      await writeDayItems(now.plainDateTime.plainDate, category, dayItem)
      output.log(colors.gray(`Added to ${category}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    // Step 10: Open in editor
    try {
      openEditor([{ file: ideaFullPath, line: markdownContent.split('\n').length }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Idea "${finalName}" created successfully`))

    return CommandResult.success({ file: ideaFullPath, name: finalName })
  }
}
