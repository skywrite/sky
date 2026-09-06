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
import TagSet from '#shared/models/TagSet/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { isParseableTarget, SlugCollisionError, writeDecision } from './lib/write.ts'

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
    'decisions:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/decisions-clarifier.prompt.md', import.meta.url).pathname
const OUTCOMES_FILE = new URL('./prompts/decisions-outcomes.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/decisions-new.prompt.md', import.meta.url).pathname

const MAX_CLARIFICATION_ROUNDS = 5
const MAX_OUTCOME_ROUNDS = 4

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// The AI response is validated against the prompt contract so a malformed
// reply degrades loudly instead of writing a half-empty document.
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

    // Step 3: Clarify the decision until it's well-formed
    const decisionResult = await runClarifierLoop(initialDescription as string, {
      promptFile: CLARIFIER_FILE,
      promptName: 'decisions-clarifier.prompt.md',
      buildInput: (currentInput, conversationHistory) => ({
        clarifier: {
          currentInput,
          conversationHistory: conversationHistory || undefined,
          notebookContext,
        },
      }),
      clearKey: 'decision',
      labels: {
        thinking: 'Analyzing your decision...',
        clear: 'Decision is clear',
        confirm: 'Decision:',
        edit: 'How would you describe the decision?',
      },
      maxRounds: MAX_CLARIFICATION_ROUNDS,
      errorSource: 'decisions:new',
      errorStage: 'clarify',
      spinner,
    })

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
    const initialOutcome = await p.text({
      message: 'What does a good outcome look like?\n',
      placeholder: 'e.g., "The new hire ramps up within 60 days and ships their first project"',
      validate: (value) => {
        if (!value.trim()) return 'Please describe the desired outcome'
      },
    })

    if (p.isCancel(initialOutcome)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    const outcomesResult = await runClarifierLoop(initialOutcome as string, {
      promptFile: OUTCOMES_FILE,
      promptName: 'decisions-outcomes.prompt.md',
      buildInput: (currentInput, conversationHistory) => ({
        outcomes: {
          decision: decisionResult.statement,
          timeframe: timeframe as string,
          currentInput,
          conversationHistory: conversationHistory || undefined,
          notebookContext,
        },
      }),
      clearKey: 'outcomes',
      labels: {
        thinking: 'Evaluating outcomes...',
        clear: 'Outcomes are clear',
        confirm: 'Desired outcomes:',
        edit: 'How would you describe the desired outcomes?',
      },
      maxRounds: MAX_OUTCOME_ROUNDS,
      errorSource: 'decisions:new',
      errorStage: 'outcomes',
      spinner,
      seedLabel: "User's initial outcome",
    })

    if (outcomesResult === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 6: Optional tags
    const tagsInput = await p.text({
      message: 'Tags (comma-separated, or press Enter to skip)\n',
      placeholder: 'e.g., hiring, leadership',
    })

    if (p.isCancel(tagsInput)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    const tags = (tagsInput as string)?.trim() ? TagSet.fromArray((tagsInput as string).split(',')) : undefined

    // Step 7: Extract title, slug, target + synthesize context summary
    spinner.start('Formatting your decision...')

    const now = await fetchNow()
    const formatContent = await readPromptFile(FORMAT_FILE)

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
        relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'decisions-new.prompt.md', formatInput)

    let aiResponse: z.infer<typeof formatSchema>

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedFormat,
      })

      aiResponse = formatSchema.parse(extractJson(result.text))
      spinner.stop('Decision formatted')
    } catch (err) {
      spinner.stop('Failed to format decision')
      await logAIError({ source: 'decisions:new', stage: 'format', message: (err as Error).message })
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format decision with AI')
    }

    // Step 8: Determine final name/slug — every source passes through slugify
    // so an AI- or user-supplied value can't smuggle path separators into the
    // filename
    const finalName =
      (overrideName ? slugify(overrideName, { preserveCase: true }) : '') ||
      slugify(aiResponse.slug, { suggestedLength: 25, preserveCase: true }) ||
      slugify(decisionResult.statement, { suggestedLength: 25, preserveCase: true })

    if (!finalName) {
      return CommandResult.fail('Could not derive a usable slug — rerun with --name')
    }

    let target = aiResponse.target ?? undefined
    if (target && !isParseableTarget(target)) {
      output.log(colors.yellow(`Ignoring unparseable AI target date: "${target}"`))
      target = undefined
    }

    // Only rel values the AI picked from the offered candidate list survive
    const rel = (aiResponse.rel ?? []).filter((r) => relCandidates.includes(r))

    // Step 9: Write the document + day item
    let written
    try {
      written = await writeDecision({
        name: finalName,
        title: aiResponse.title,
        context: aiResponse.contextSummary,
        desiredOutcomes: aiResponse.outcomesSummary,
        target,
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

    output.log(colors.green(`\nCreated decision: ${written.file}`))

    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    } else {
      output.log(colors.gray(`Added to ${category}: ${written.dayItem}`))
    }

    // Step 10: Open in editor
    try {
      openEditor([{ file: written.file, line: written.markdown.split('\n').length }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Decision "${finalName}" created successfully`))

    return CommandResult.success({ file: written.file, name: finalName })
  }
}
