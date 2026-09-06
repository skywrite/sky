import * as p from '@clack/prompts'
import { generateObject } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import type { CommandContext } from '#commands/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { aiModel } from '#shared/ai/models.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import { miFrontmatter, toSingleLine } from '#shared/models/MostImportant/frontmatter.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { CONTEXT_TOKENS_TRIPWIRE, gatherContext } from './gatherContext.ts'
import { buildMIBody, type MISections, type QAAnswers } from './miDocument.ts'
import { readMultiline } from './readMultiline.ts'

const PROMPT_FILE = new URL('../prompts/suggest-mi.prompt.md', import.meta.url).pathname
const PROMPT_CLARIFY = new URL('../prompts/mi-clarifier.prompt.md', import.meta.url).pathname
const PROMPT_SYNTHESIZE = new URL('../prompts/mi-synthesizer.prompt.md', import.meta.url).pathname
const MAX_CLARIFICATION_ROUNDS = 3

export interface SuggestResult {
  summary: string
  markdown: string
  dueBy?: string
}

interface SuggestOptions {
  context: CommandContext
  today: PlainDate
  /** HH:MM run time, so suggestions respect the remaining day */
  time?: string
  dryRun?: boolean
  inspect?: boolean
  depend?: boolean
}

const SuggestionsSchema = z.object({
  contextSummary: z.string().describe('1-2 line summary of key themes and pressures from context'),
  suggestions: z
    .array(
      z.object({
        summary: z.string().describe('Action verb + specific outcome, 7-9 words'),
        reason: z.string().describe('Why this action matters today, 1 sentence'),
      }),
    )
    .min(1)
    .describe('Exactly 5 suggestions'),
})

// ---------------------------------------------------------------------------
// Clarification loop
// ---------------------------------------------------------------------------

/** Wrapped in an object because structured output needs an object at the top level. */
const ClarifierSchema = z.object({
  result: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('clear'),
      mi: z.string().describe('The sharpened MI statement — a single line'),
      summary: z.string().describe('Why this MI is high-leverage today (1 sentence)'),
    }),
    z.object({
      status: z.literal('unclear'),
      question: z.string().describe('Your single sharpening question'),
      reason: z.string().describe("What's missing — specificity, action, or strategic alignment (1 sentence)"),
    }),
  ]),
})

const FinalStatementSchema = z.object({
  mi: z.string().describe('The final sharpened MI statement — a single line starting with an action verb'),
})

interface ClarifyResult {
  statement: string
  conversation: string
}

function warnAIError(err: unknown): void {
  p.log.warn(colors.dim(err instanceof Error ? err.message : String(err)))
}

/**
 * Run the MI clarifier to sharpen the selected MI.
 * Returns the clarified MI statement + conversation, or null if user cancels.
 * Every exit yields a single-line statement — it becomes YAML `summary:` and
 * a day-file link label downstream, where a multi-line value silently
 * corrupts the document.
 */
async function clarifyMI(
  initialInput: string,
  spinner: ReturnType<typeof p.spinner>,
  notebookContext?: string,
): Promise<ClarifyResult | null> {
  const clarifierContent = await readPromptFile(PROMPT_CLARIFY)
  let currentInput = initialInput
  let conversationHistory = `User's initial MI: "${initialInput}"`
  let lastWasUserEdit = false

  const renderClarifier = () => {
    const clarifierInput: RenderInput = {
      clarifier: {
        currentInput,
        conversationHistory: conversationHistory || undefined,
        notebookContext,
      },
    }
    return renderPromptFile(clarifierContent, 'mi-clarifier.prompt.md', clarifierInput).output
  }

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Sharpening your MI...')

    let clarifierResult: z.infer<typeof ClarifierSchema>['result']

    try {
      const result = await generateObject({
        ...aiModel('reasoning'),
        schema: ClarifierSchema,
        prompt: renderClarifier(),
      })

      clarifierResult = result.object.result
    } catch (err) {
      spinner.stop(colors.yellow('Clarification failed — continuing with your statement unsharpened'))
      warnAIError(err)
      return { statement: toSingleLine(currentInput), conversation: conversationHistory }
    }

    if (clarifierResult.status === 'clear') {
      spinner.stop(colors.green('MI is sharp'))

      const confirmed = await p.confirm({
        message: `${colors.bold('MI:')} ${clarifierResult.mi}\n\n  ${colors.dim(
          clarifierResult.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return { statement: toSingleLine(clarifierResult.mi), conversation: conversationHistory }
      }

      const edited = await p.text({
        message: 'How would you describe the MI?\n',
        initialValue: clarifierResult.mi,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = toSingleLine(edited as string)
      lastWasUserEdit = true
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // MI is unclear - ask the sharpening question
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
    lastWasUserEdit = false
  }

  // Rounds exhausted. A user edit stands as written; a trailing Q&A leaves
  // currentInput as a multi-line blob, so force one final synthesis into a
  // statement instead of letting the blob escape.
  if (lastWasUserEdit) {
    return { statement: toSingleLine(currentInput), conversation: conversationHistory }
  }

  spinner.start('Finalizing your MI...')
  try {
    const final = await generateObject({
      ...aiModel('reasoning'),
      schema: FinalStatementSchema,
      prompt:
        renderClarifier() +
        '\n\nClarification rounds are exhausted. Do not ask another question. Synthesize the final MI statement from the conversation above.',
    })
    spinner.stop(colors.green('MI finalized'))
    return { statement: toSingleLine(final.object.mi), conversation: conversationHistory }
  } catch (err) {
    spinner.stop(colors.yellow('Finalizing failed — continuing with your statement unsharpened'))
    warnAIError(err)
    return { statement: toSingleLine(currentInput), conversation: conversationHistory }
  }
}

// ---------------------------------------------------------------------------
// Interactive Q&A
// ---------------------------------------------------------------------------

/**
 * Ask the MI template questions in the terminal. The prose questions use the
 * multi-line reader so answers arrive at full fidelity — pasted paragraphs,
 * blank lines and all — instead of being cut at the first ENTER.
 * Returns the answers, or null if the user cancels.
 */
async function askMIQuestions(depend?: boolean): Promise<QAAnswers | null> {
  const dueBy = await p.text({
    message: 'When is this due today?\n',
    placeholder: 'e.g., 15:00 — press ENTER to skip',
  })

  if (p.isCancel(dueBy)) return null

  const strategic = await readMultiline('How does this move you toward 10x?')
  if (strategic === null) return null

  const doneLooksLike = await readMultiline('What does "done" look like by end of day?')
  if (doneLooksLike === null) return null

  let dependencies: string | undefined
  if (depend) {
    const deps = await readMultiline('Who do you depend on, and what do they need to do?')
    if (deps === null) return null
    if (deps) dependencies = deps
  }

  const notes = await readMultiline('Any other context or notes?')
  if (notes === null) return null

  return {
    dueBy: (dueBy as string) || undefined,
    strategic,
    doneLooksLike,
    dependencies,
    notes: notes || undefined,
  }
}

// ---------------------------------------------------------------------------
// AI Synthesis
// ---------------------------------------------------------------------------

const EnrichedSectionsSchema = z.object({
  focus: z
    .string()
    .describe('1-3 sentences starting from the MI statement, with enough context to make sense tomorrow'),
  whyThisMatters: z
    .string()
    .describe("The strategic reasoning, enriched from the user's answer — every point kept, written well"),
  doneLooksLike: z.array(z.string()).min(1).describe('Concrete, checkable outcomes drawn from the answers'),
  dependencies: z.string().nullish().describe('Only when the user gave dependencies: who, and what they must do'),
  notes: z.string().nullish().describe('Only when the user gave notes: their additional context, cleaned up'),
})

/**
 * Build the MI document: the model enriches the interview answers into the
 * document sections — structured, sharpened, expanded — keeping every
 * substantive point the user made. The heading skeleton and frontmatter are
 * built in code, never by the model, and when enrichment fails the raw
 * answers stand so the document always reflects what the user said.
 * Returns the full markdown content (frontmatter + body).
 */
async function synthesizeMI(opts: {
  statement: string
  conversation: string
  answers: QAAnswers
  today: PlainDate
  spinner: ReturnType<typeof p.spinner>
}): Promise<string> {
  const { statement, conversation, answers, today, spinner } = opts

  spinner.start('Enriching your answers...')

  const synthContent = await readPromptFile(PROMPT_SYNTHESIZE)
  const synthInput: RenderInput = {
    synthesizer: {
      statement,
      conversation,
      dueBy: answers.dueBy || undefined,
      strategic: answers.strategic || undefined,
      doneLooksLike: answers.doneLooksLike || undefined,
      dependencies: answers.dependencies || undefined,
      notes: answers.notes || undefined,
    },
  }

  const { output: renderedSynth } = renderPromptFile(synthContent, 'mi-synthesizer.prompt.md', synthInput)

  // Raw answers are the floor: any section enrichment leaves empty — or the
  // whole call failing — falls back to what the user actually wrote.
  let sections: MISections = {
    focus: statement,
    whyThisMatters: answers.strategic,
    doneLooksLike: answers.doneLooksLike,
    ...(answers.dependencies ? { dependencies: answers.dependencies } : {}),
    ...(answers.notes ? { notes: answers.notes } : {}),
  }

  try {
    const result = await generateObject({
      ...aiModel('reasoning'),
      schema: EnrichedSectionsSchema,
      prompt: renderedSynth,
    })
    const enriched = result.object
    sections = {
      focus: enriched.focus.trim() || statement,
      whyThisMatters: enriched.whyThisMatters.trim() || answers.strategic,
      doneLooksLike: enriched.doneLooksLike.length > 0 ? enriched.doneLooksLike : answers.doneLooksLike,
      ...(answers.dependencies ? { dependencies: enriched.dependencies?.trim() || answers.dependencies } : {}),
      ...(answers.notes ? { notes: enriched.notes?.trim() || answers.notes } : {}),
    }
    spinner.stop(colors.green('Document ready'))
  } catch (err) {
    spinner.stop(colors.yellow('Enrichment failed — keeping your answers as written'))
    warnAIError(err)
  }

  // Frontmatter is built programmatically (never by the model) and
  // YAML-serialized so any summary round-trips.
  return miFrontmatter(statement) + '\n\n' + buildMIBody(sections, today) + '\n'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Gather notebook context (direct reads — goals, pending decisions, week plan,
 * last 7 days) and use AI to suggest the most important thing.
 * Three-phase flow: (1) suggest/pick/write, (2) AI clarification, (3) Q&A + synthesis.
 */
export async function suggestMostImportant(opts: SuggestOptions): Promise<SuggestResult> {
  const { context, today, time, dryRun, inspect, depend } = opts
  const { output } = context
  const empty: SuggestResult = { summary: '', markdown: '' }

  // 1. Gather context (goals, pending decisions, week plan, last 7 days)
  output.log('Gathering context...')
  const miContext = await gatherContext(today, time)

  if (miContext.documentCount === 0) {
    return { summary: 'No documents found - start your day first', markdown: '' }
  }

  output.log(`Loaded ${miContext.documentCount} documents (~${Math.round(miContext.totalTokens / 1000)}k tokens)`)
  if (miContext.totalTokens > CONTEXT_TOKENS_TRIPWIRE) {
    output.log(
      `WARN: context is unusually large (>${CONTEXT_TOKENS_TRIPWIRE} estimated tokens) — check the day window for oversized files`,
    )
  }

  // 2. Load and render prompt template
  output.log('Generating suggestions...')
  const promptTemplate = await readPromptFile(PROMPT_FILE)
  const renderResult = renderPromptFile(promptTemplate, 'suggest-mi.prompt.md', {
    context: {
      notebookDate: miContext.today.date,
    },
    user: {
      dayOfWeek: miContext.today.dayOfWeek,
      ...(miContext.today.time ? { time: miContext.today.time, timeOfDay: miContext.today.timeOfDay } : {}),
      ...(miContext.todayMIs.length > 0 ? { todayMIs: miContext.todayMIs.map((s) => `- ${s}`).join('\n') } : {}),
      dayContext: miContext.contextMarkdown,
    },
  })

  // 3. If inspect mode, write prompt to temp file and open in VSCode
  if (inspect) {
    const tmpPath = `/tmp/mi-suggest-prompt-${today.ymd}.md`
    await writeTextFile(tmpPath, renderResult.output)
    output.log(`Opening prompt in VSCode: ${tmpPath}`)
    openEditor([{ file: tmpPath }])
    return empty
  }

  // 4. Call AI for suggestions
  const result = await generateObject({
    ...aiModel('reasoning'),
    schema: SuggestionsSchema,
    prompt: renderResult.output,
  })

  const { contextSummary, suggestions } = result.object

  // 5. Display context summary and suggestions
  let currentSuggestions = suggestions

  const displaySuggestions = () => {
    output.log('')
    output.log(colors.dim(contextSummary))
    output.log('')
    output.log(colors.bold('Suggestions:'))
    output.log('')
    for (let i = 0; i < currentSuggestions.length; i++) {
      const s = currentSuggestions[i]
      output.log(`  ${colors.cyan(`[${i + 1}]`)} ${colors.bold(s.summary)}`)
      output.log(`      ${colors.dim(s.reason)}`)
      output.log('')
    }
  }

  if (dryRun) {
    displaySuggestions()
    return { summary: currentSuggestions[0].summary, markdown: '' }
  }

  // 6. Selection loop (pick, write own, or refine)
  let selectedMI: string | null = null

  while (selectedMI === null) {
    displaySuggestions()

    const options = [
      ...currentSuggestions.map((s, i) => ({
        value: i,
        label: `[${i + 1}] ${s.summary}`,
      })),
      { value: -1, label: '[w] Write your own' },
      { value: -2, label: '[r] Refine with feedback' },
    ]

    const choice = await p.select({
      message: 'Select:',
      options,
    })

    if (p.isCancel(choice)) {
      p.cancel('Cancelled.')
      return empty
    }

    if (choice === -1) {
      // Write your own
      const custom = await p.text({
        message: 'What is your Most Important thing today?\n',
        placeholder: 'e.g., Send Atlas term sheet to legal by 3pm',
      })

      if (p.isCancel(custom) || !custom) {
        continue
      }

      selectedMI = custom as string
    } else if (choice === -2) {
      // Refine - get feedback and regenerate
      const feedback = await p.text({
        message: 'What should change?',
        placeholder: 'e.g., focus more on urgent items, less on health',
      })

      if (p.isCancel(feedback) || !feedback) {
        continue
      }

      const spinner = p.spinner()
      spinner.start('Refining suggestions...')

      const refinedResult = await generateObject({
        ...aiModel('reasoning'),
        schema: SuggestionsSchema,
        prompt:
          renderResult.output +
          `\n\n---\n\nUser feedback on previous suggestions: ${feedback}\n\nGenerate 5 NEW suggestions based on this feedback.`,
      })

      spinner.stop('Done')
      currentSuggestions = refinedResult.object.suggestions
    } else {
      // Valid selection (0, 1, or 2)
      selectedMI = currentSuggestions[choice].summary
    }
  }

  output.log(`\n${colors.green('→')} ${colors.bold(selectedMI)}`)

  // 7. Clarification loop
  const spinner = p.spinner()
  const clarified = await clarifyMI(selectedMI, spinner, miContext.contextMarkdown)

  if (clarified === null) {
    p.cancel('Cancelled.')
    return empty
  }

  output.log(`\n${colors.green('→')} ${colors.bold(clarified.statement)}`)

  // 8. Q&A in the terminal — prose answers through the multi-line reader
  const answers = await askMIQuestions(depend)

  if (answers === null) {
    p.cancel('Cancelled.')
    return empty
  }

  // 9. AI Synthesis — produce the final document
  const markdown = await synthesizeMI({
    statement: clarified.statement,
    conversation: clarified.conversation,
    answers,
    today,
    spinner,
  })

  return { summary: clarified.statement, markdown, dueBy: answers.dueBy }
}
