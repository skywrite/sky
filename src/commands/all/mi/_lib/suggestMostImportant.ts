import * as p from '@clack/prompts'
import { generateObject, generateText } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import type { CommandContext } from '#commands/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { dayWord } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { gatherContext } from './gatherContext.ts'

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
    .describe('Exactly 3 suggestions'),
})

// ---------------------------------------------------------------------------
// Clarification loop
// ---------------------------------------------------------------------------

type ClarifierResult =
  | { status: 'clear'; mi: string; summary: string }
  | { status: 'unclear'; question: string; reason: string }

interface ClarifyResult {
  statement: string
  conversation: string
}

/**
 * Run the MI clarifier to sharpen the selected MI.
 * Returns the clarified MI statement + conversation, or null if user cancels.
 */
async function clarifyMI(
  initialInput: string,
  spinner: ReturnType<typeof p.spinner>,
  notebookContext?: string,
): Promise<ClarifyResult | null> {
  const clarifierContent = await readTextFile(PROMPT_CLARIFY)
  let currentInput = initialInput
  let conversationHistory = `User's initial MI: "${initialInput}"`

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Sharpening your MI...')

    const clarifierInput: RenderInput = {
      clarifier: {
        currentInput,
        conversationHistory: conversationHistory || undefined,
        notebookContext,
      },
    }

    const { output: renderedClarifier } = renderPromptFile(clarifierContent, 'mi-clarifier.prompt.md', clarifierInput)

    let clarifierResult: ClarifierResult

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedClarifier,
      })

      clarifierResult = extractJson<typeof clarifierResult>(result.text)
    } catch {
      spinner.stop('Clarification failed')
      return { statement: currentInput, conversation: conversationHistory }
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
        return { statement: clarifierResult.mi, conversation: conversationHistory }
      }

      const edited = await p.text({
        message: 'How would you describe the MI?\n',
        initialValue: clarifierResult.mi,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
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
  }

  return { statement: currentInput, conversation: conversationHistory }
}

// ---------------------------------------------------------------------------
// Interactive Q&A
// ---------------------------------------------------------------------------

interface QAAnswers {
  dueBy?: string
  strategic: string
  doneLooksLike: string
  dependencies?: string
  notes?: string
}

/**
 * Ask the MI template questions interactively in the terminal.
 * Returns the collected answers, or null if user cancels.
 */
async function askMIQuestions(statement: string, depend?: boolean): Promise<QAAnswers | null> {
  // Q: When is this due?
  const dueBy = await p.text({
    message: 'When is this due today?\n',
    placeholder: 'e.g., 15:00, EOD — press ENTER to skip',
  })

  if (p.isCancel(dueBy)) return null

  // Q: Does this move your company toward 10x? Elaborate.
  const strategic = await p.text({
    message: 'How does this move you toward 10x?\n',
    placeholder: "Strategic reasoning — what's at stake if this doesn't get done today?",
  })

  if (p.isCancel(strategic)) return null

  // Q: What does done look like?
  const doneLooksLike = await p.text({
    message: 'What does "done" look like by end of day?\n',
    placeholder: 'Concrete outcomes — e.g., "email sent", "decision made", "doc reviewed"',
  })

  if (p.isCancel(doneLooksLike)) return null

  // Q: Dependencies (only if --depend flag)
  let dependencies: string | undefined
  if (depend) {
    const deps = await p.text({
      message: 'Who do you depend on, and what do they need to do?\n',
      placeholder: 'e.g., "Sarah needs to review the term sheet by 2pm"',
    })

    if (p.isCancel(deps)) return null
    if (deps) dependencies = deps as string
  }

  // Q: Any other notes?
  const notes = await p.text({
    message: 'Any other context or notes?\n',
    placeholder: 'Press ENTER to skip',
  })

  if (p.isCancel(notes)) return null

  return {
    dueBy: (dueBy as string) || undefined,
    strategic: (strategic as string) || '',
    doneLooksLike: (doneLooksLike as string) || '',
    dependencies,
    notes: (notes as string) || undefined,
  }
}

// ---------------------------------------------------------------------------
// AI Synthesis
// ---------------------------------------------------------------------------

/**
 * Use AI to synthesize the MI interview into a polished markdown document.
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

  spinner.start('Writing your MI document...')

  const synthContent = await readTextFile(PROMPT_SYNTHESIZE)
  const synthInput: RenderInput = {
    synthesizer: {
      date: today.ymd,
      dayWord: dayWord(today.toDate(), 'short'),
      statement,
      conversation,
      dueBy: answers.dueBy || undefined,
      strategic: answers.strategic,
      doneLooksLike: answers.doneLooksLike || undefined,
      dependencies: answers.dependencies || undefined,
      notes: answers.notes || undefined,
    },
  }

  const { output: renderedSynth } = renderPromptFile(synthContent, 'mi-synthesizer.prompt.md', synthInput)

  let body: string
  try {
    const result = await generateText({
      ...aiModel('reasoning'),
      prompt: renderedSynth,
    })
    body = result.text.trim()
  } catch {
    spinner.stop('Synthesis failed — using raw answers')
    body = fallbackBody(statement, answers, today)
  }

  spinner.stop(colors.green('Document ready'))

  // Build frontmatter programmatically for reliability
  const frontmatter = ['---', `summary: ${statement}`, 'complete:', 'dateStarted:', 'rel:', 'tags:', '---'].join('\n')

  return frontmatter + '\n\n' + body + '\n'
}

/**
 * Fallback body if AI synthesis fails — structured but not polished.
 */
function fallbackBody(statement: string, answers: QAAnswers, today: PlainDate): string {
  const lines = [
    `# **${today.ymd} - ${dayWord(today.toDate(), 'short')}**`,
    '',
    '## Focus',
    '',
    statement,
    '',
    '## Why This Matters',
    '',
    answers.strategic || '(not provided)',
    '',
    '## Done Looks Like',
    '',
    answers.doneLooksLike || '(not provided)',
  ]

  if (answers.dependencies) {
    lines.push('', '## Dependencies', '', answers.dependencies)
  }

  if (answers.notes) {
    lines.push('', '## Notes', '', answers.notes)
  }

  lines.push('', '## Reflection', '', '')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Gather context using DomainCollection and use AI to suggest the most important thing.
 * Three-phase flow: (1) suggest/pick/write, (2) AI clarification, (3) Q&A + synthesis.
 */
export async function suggestMostImportant(opts: SuggestOptions): Promise<SuggestResult> {
  const { context, today, dryRun, inspect, depend } = opts
  const { output } = context
  const empty: SuggestResult = { summary: '', markdown: '' }

  // 1. Gather context (5-day lookback, full store, pending decisions + goals)
  output.log('Gathering context...')
  const miContext = await gatherContext(today)

  if (miContext.documentCount === 0) {
    return { summary: 'No documents found - start your day first', markdown: '' }
  }

  output.log(
    `Loaded ${miContext.documentCount} documents (~${Math.round(miContext.totalTokens / 1000)}k tokens` +
      (miContext.prunedCount > 0 ? `, ${miContext.prunedCount} pruned` : '') +
      ')',
  )

  // 2. Load and render prompt template
  output.log('Generating suggestions...')
  const promptTemplate = await readTextFile(PROMPT_FILE)
  const renderResult = renderPromptFile(promptTemplate, 'suggest-mi.prompt.md', {
    context: {
      notebookDate: miContext.today.date,
    },
    user: {
      dayOfWeek: miContext.today.dayOfWeek,
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
          `\n\n---\n\nUser feedback on previous suggestions: ${feedback}\n\nGenerate 3 NEW suggestions based on this feedback.`,
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

  // 8. Interactive Q&A — ask the MI template questions
  const answers = await askMIQuestions(clarified.statement, depend)

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
