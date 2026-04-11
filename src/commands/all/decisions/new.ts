import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import colors from 'picocolors'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

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
    'decisions:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const MODEL = anthropic('claude-opus-4-6')
const MODEL_LIGHT = anthropic('claude-haiku-4-5-20251001')
const CLARIFIER_FILE = new URL('./prompts/decisions-clarifier.prompt.md', import.meta.url).pathname
const OUTCOMES_FILE = new URL('./prompts/decisions-outcomes.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/decisions-new.prompt.md', import.meta.url).pathname

const MAX_CLARIFICATION_ROUNDS = 5
const MAX_OUTCOME_ROUNDS = 4

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type ClarifierResult =
  | { status: 'clear'; decision: string; summary: string }
  | { status: 'unclear'; question: string; reason: string }

type OutcomeResult =
  | { status: 'clear'; outcomes: string; summary: string }
  | { status: 'unclear'; question: string; reason: string }

/**
 * Strip markdown code fences from AI response text.
 */
function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return cleaned
}

interface ClarifyResult {
  /** The final refined statement */
  statement: string
  /** Full conversation history (Q&A exchanges) */
  conversation: string
}

/**
 * Run the decision clarifier to ensure the decision is well-formed.
 * Returns the clarified decision statement + conversation, or null if user cancels.
 */
async function clarifyDecision(
  initialInput: string,
  spinner: ReturnType<typeof p.spinner>,
  notebookContext?: string,
): Promise<ClarifyResult | null> {
  const clarifierContent = await readTextFile(CLARIFIER_FILE)
  let currentInput = initialInput
  let conversationHistory = `User's initial description: "${initialInput}"`

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Analyzing your decision...')

    const clarifierInput: RenderInput = {
      clarifier: {
        currentInput,
        conversationHistory: conversationHistory || undefined,
        notebookContext,
      },
    }

    const { output: renderedClarifier } = renderPromptFile(
      clarifierContent,
      'decisions-clarifier.prompt.md',
      clarifierInput,
    )

    let clarifierResult: ClarifierResult

    try {
      const result = await generateText({
        model: MODEL,
        prompt: renderedClarifier,
      })

      clarifierResult = JSON.parse(stripCodeFences(result.text))
    } catch {
      spinner.stop('Clarification failed')
      return { statement: currentInput, conversation: conversationHistory }
    }

    if (clarifierResult.status === 'clear') {
      spinner.stop(colors.green('Decision is clear'))

      const confirmed = await p.confirm({
        message: `${colors.bold('Decision:')} ${clarifierResult.decision}\n\n  ${colors.dim(
          clarifierResult.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return { statement: clarifierResult.decision, conversation: conversationHistory }
      }

      const edited = await p.text({
        message: 'How would you describe the decision?\n',
        initialValue: clarifierResult.decision,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // Decision is unclear - ask the clarifying question
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

  return { statement: currentInput, conversation: conversationHistory }
}

/**
 * Run the outcome clarifier to help articulate desired outcomes.
 * Returns the clarified outcomes + conversation, or null if user cancels.
 */
async function clarifyOutcomes(
  decision: string,
  timeframe: string,
  spinner: ReturnType<typeof p.spinner>,
  notebookContext?: string,
): Promise<ClarifyResult | null> {
  const outcomesContent = await readTextFile(OUTCOMES_FILE)

  const initialOutcome = await p.text({
    message: 'What does a good outcome look like?\n',
    placeholder: 'e.g., "The new hire ramps up within 60 days and ships their first project"',
    validate: (value) => {
      if (!value.trim()) return 'Please describe the desired outcome'
    },
  })

  if (p.isCancel(initialOutcome)) {
    return null
  }

  let currentInput = initialOutcome as string
  let conversationHistory = `User's initial outcome: "${initialOutcome}"`

  for (let round = 0; round < MAX_OUTCOME_ROUNDS; round++) {
    spinner.start('Evaluating outcomes...')

    const outcomesInput: RenderInput = {
      outcomes: {
        decision,
        timeframe,
        currentInput,
        conversationHistory: conversationHistory || undefined,
        notebookContext,
      },
    }

    const { output: renderedOutcomes } = renderPromptFile(
      outcomesContent,
      'decisions-outcomes.prompt.md',
      outcomesInput,
    )

    let outcomeResult: OutcomeResult

    try {
      const result = await generateText({
        model: MODEL,
        prompt: renderedOutcomes,
      })

      outcomeResult = JSON.parse(stripCodeFences(result.text))
    } catch {
      spinner.stop('Outcome clarification failed')
      return { statement: currentInput, conversation: conversationHistory }
    }

    if (outcomeResult.status === 'clear') {
      spinner.stop(colors.green('Outcomes are clear'))

      const confirmed = await p.confirm({
        message: `${colors.bold('Desired outcomes:')} ${outcomeResult.outcomes}\n\n  ${colors.dim(
          outcomeResult.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return { statement: outcomeResult.outcomes, conversation: conversationHistory }
      }

      const edited = await p.text({
        message: 'How would you describe the desired outcomes?\n',
        initialValue: outcomeResult.outcomes,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // Outcomes are unclear - ask the clarifying question
    spinner.stop(colors.dim(outcomeResult.reason))

    const answer = await p.text({
      message: `${outcomeResult.question}\n`,
      placeholder: 'Your answer...',
    })

    if (p.isCancel(answer)) {
      return null
    }

    conversationHistory += `\nAI asked: "${outcomeResult.question}"\nUser answered: "${answer}"`
    currentInput = `${currentInput}\n\nClarification: ${answer}`
  }

  return { statement: currentInput, conversation: conversationHistory }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DecisionsNewTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:new',
    description: 'Create a new decision with AI-guided interview.',
    descriptionLong: [
      'Creates a new Decision document with an AI-guided interview flow.',
      'The AI clarifies the decision and helps articulate desired outcomes.',
    ],
    usage: [
      'sky decisions:new                    # Interactive AI-guided flow',
      'sky decisions:new --name my-decision # Override slug name',
      'sky decisions:new --category Personal # Set day item category',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { name: overrideName, category } = args

    p.intro(colors.bold(colors.cyan('New Decision')))

    const spinner = p.spinner()

    // Step 1: Gather initial decision description
    const initialDescription = await p.text({
      message: 'What is the decision that needs to be made?\n',
      placeholder: 'e.g., "Whether to hire Sarah as VP Engineering"',
      validate: (value) => {
        if (!value.trim()) return 'Please describe the decision'
      },
    })

    if (p.isCancel(initialDescription)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 2: Gather notebook context (like ideas:new)
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

    // Step 3: Clarify the decision until it's well-formed
    const decisionResult = await clarifyDecision(initialDescription as string, spinner, notebookContext)

    if (decisionResult === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 4: Timeframe
    const timeframe = await p.text({
      message: 'What is your timeframe?\n',
      placeholder: 'e.g., "End of this week", "Before Q2", "No rush"',
      validate: (value) => {
        if (!value.trim()) return 'Please provide a timeframe'
      },
    })

    if (p.isCancel(timeframe)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 5: Clarify desired outcomes
    const outcomesResult = await clarifyOutcomes(
      decisionResult.statement,
      timeframe as string,
      spinner,
      notebookContext,
    )

    if (outcomesResult === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 6: Extract title, slug, target + synthesize context summary
    spinner.start('Formatting your decision...')

    const now = await fetchNow()
    const formatContent = await readTextFile(FORMAT_FILE)

    const formatInput: RenderInput = {
      context: {
        notebookDate: now.plainDateTime.date,
        systemDate: context.systemNow.date,
        notebookTimezone: now.timezone,
        systemTimezone: context.systemNow.timezone,
      },
      decision: {
        description: decisionResult.statement,
        timeframe: timeframe as string,
        decisionConversation: decisionResult.conversation || undefined,
        outcomesConversation: outcomesResult.conversation || undefined,
        desiredOutcomes: outcomesResult.statement,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'decisions-new.prompt.md', formatInput)

    let aiResponse: {
      title: string
      slug: string
      target: string | null
      contextSummary: string
      outcomesSummary: string
    }

    try {
      const result = await generateText({
        model: MODEL,
        prompt: renderedFormat,
      })

      aiResponse = JSON.parse(stripCodeFences(result.text))
      spinner.stop('Decision formatted')
    } catch (err) {
      spinner.stop('Failed to format decision')
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format decision with AI')
    }

    // Step 7: Determine final name/slug
    const finalName =
      overrideName ?? aiResponse.slug ?? slugify(decisionResult.statement, { suggestedLength: 25, preserveCase: true })

    // Step 8: Create the Decision document
    const identified = new ZonedDateTime(now.plainDateTime, now.timezone)
    const decision = DecisionDocument.create({
      name: finalName,
      identified,
      target: aiResponse.target ?? undefined,
      title: aiResponse.title,
      context: aiResponse.contextSummary,
      desiredOutcomes: aiResponse.outcomesSummary,
    })

    // Step 9: Write to file in pending/month-identified/
    const year = now.plainDateTime.plainDate.year
    const month = String(now.plainDateTime.plainDate.month).padStart(2, '0')
    const decisionsFullPath = path.join(DIR_DECISIONS, String(year), 'pending', month, `${finalName}.md`)

    // Ensure directory exists
    const decisionsDir = path.dirname(decisionsFullPath)
    if (!(await exists(decisionsDir))) {
      await outputFile(path.join(decisionsDir, '.gitkeep'), '')
    }

    // Write the decision file
    const markdownContent = decision.toMarkdown()
    await outputFile(decisionsFullPath, markdownContent)

    output.log(colors.green(`\nCreated decision: ${decisionsFullPath}`))

    // Step 10: Add day item
    const entryTime = now.plainDateTime.time
    const dayItem = `${entryTime} > decisions/${finalName} -> Identified | ${aiResponse.title}`

    try {
      await writeDayItems(now.plainDateTime.plainDate, category, dayItem)
      output.log(colors.gray(`Added to ${category}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    // Step 11: Open in editor
    try {
      openEditor([{ file: decisionsFullPath, line: markdownContent.split('\n').length }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Decision "${finalName}" created successfully`))

    return CommandResult.success({ file: decisionsFullPath, name: finalName })
  }
}
