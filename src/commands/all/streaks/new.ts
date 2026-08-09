import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { z } from 'zod'
import { type ClarifierRound, gatherNotebookContext, runClarifierRound } from '#commands/lib/interview.ts'
import { categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { promptMultiline } from '#lib/tui/MultilineTextPrompt.tsx'
import { textSpinner, type TextSpinner } from '#lib/tui/textSpinner.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import type { StreakSchedule } from '#shared/models/Streak/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import * as dateFns from '#universal/dates/dateFns/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { editText, stripEmbeddedComments } from './lib/editText.ts'
import { plannedEndAfter, type PlannedEndUnit } from './lib/plannedEnd.ts'
import { SlugCollisionError, TitleCollisionError, writeStreak } from './lib/write.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Flag.string('Override the generated slug/name', {
    short: 'n',
    optional: true,
  }),
  schedule: Flag.string('Schedule: "daily" or "weekdays" (skips the prompt)', {
    short: 's',
    optional: true,
  }),
  category: categoryComplete({ defaultCategory: 'Personal' }),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/streaks-clarifier.prompt.md', import.meta.url).pathname
const REVIEW_FILE = new URL('./prompts/streaks-review.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/streaks-format.prompt.md', import.meta.url).pathname

const MAX_CLARIFICATION_ROUNDS = 3

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// AI responses are validated against the prompt contracts so a malformed
// reply degrades loudly instead of writing a half-empty document.

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

/**
 * Echo captured input (pastes expanded) right below the prompt, so the exact
 * text the AI will see stays visible in scrollback while it processes.
 */
function echoCaptured(log: (msg: string) => void, text: string): void {
  log(
    text
      .split('\n')
      .map((line) => colors.dim(`  │ ${line}`))
      .join('\n'),
  )
}

/**
 * Run the streak clarifier until the habit is binary, small, and controllable.
 * The judgment inside each round is the shared runClarifierRound; the shell
 * stays streaks-specific because answers use the Ink multiline prompt (pasted
 * rule blocks arrive intact and are collected into capturedBlocks to seed the
 * details editor). Returns the clarified habit statement, or null on cancel.
 */
async function clarifyHabit(
  initialInput: string,
  spinner: TextSpinner,
  log: (msg: string) => void,
  capturedBlocks: string[],
  notebookContext?: string,
): Promise<string | null> {
  const promptContent = await readTextFile(CLARIFIER_FILE)
  let currentInput = initialInput
  let conversationHistory = `User's initial description: "${initialInput}"`

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Thinking about your habit...')

    let outcome: ClarifierRound

    try {
      outcome = await runClarifierRound({
        promptContent,
        promptName: 'streaks-clarifier.prompt.md',
        input: {
          clarifier: {
            currentInput,
            conversationHistory: conversationHistory || undefined,
            notebookContext,
          },
        },
        clearKey: 'habit',
        errorSource: 'streaks:new',
        errorStage: 'clarify',
      })
    } catch {
      // Already logged by the round
      spinner.stop('Clarification failed — keeping your description as written')
      return currentInput
    }

    if (outcome.kind === 'clear') {
      spinner.stop(colors.green('Habit is streak-worthy'))

      const summaryLine = outcome.summary ? `\n\n  ${colors.dim(outcome.summary)}` : ''
      const confirmed = await p.confirm({
        message: `${colors.bold('Habit:')} ${outcome.statement}${summaryLine}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return outcome.statement
      }

      // clack p.text on purpose: this edits the one-line habit statement, and
      // an Ink prompt must never follow a clack prompt on the same stdin
      // (clack's readline leaves the stream in a state that starves Ink's
      // reads under bun). Multi-line pasting lives in the answer prompts.
      const edited = await p.text({
        message: 'How would you describe the habit?\n',
        initialValue: outcome.statement,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      // Record what was rejected, not just the replacement — later rounds
      // shouldn't re-propose a statement the user already turned down
      conversationHistory += `\nAI proposed: "${outcome.statement}"\nUser revised to: "${currentInput}"`
      continue
    }

    // Habit is unclear - ask the clarifying question
    spinner.stop(colors.dim(outcome.reason))

    const answer = await promptMultiline({
      message: outcome.question,
      placeholder: 'Your answer - pasted blocks arrive intact...',
    })

    if (answer === null) {
      return null
    }

    echoCaptured(log, answer)
    if (answer.includes('\n')) capturedBlocks.push(answer)

    conversationHistory += `\nAI asked: "${outcome.question}"\nUser answered: "${answer}"`
    currentInput = `${currentInput}\n\nClarification: ${answer}`
  }

  // Max rounds reached - proceed with what we have
  return currentInput
}

/**
 * Review the detailed rules for the gaps that kill streaks: loopholes,
 * contradictions, ambiguity, missing failure modes. The goal is completion —
 * every question closes a future rationalization. Questions are asked one at
 * a time; Enter on an empty answer skips a question (some will be bad), ESC
 * skips the rest. Answers are appended verbatim as a Clarifications section —
 * the AI never rewrites the user's text. All failures are non-fatal.
 */
async function reviewDetails(habit: string, schedule: string, details: string, spinner: TextSpinner): Promise<string> {
  spinner.start('Reviewing the rules...')

  let review: z.infer<typeof reviewSchema>
  try {
    const reviewContent = await readTextFile(REVIEW_FILE)
    const { output: rendered } = renderPromptFile(reviewContent, 'streaks-review.prompt.md', {
      review: { habit, schedule, details },
    })

    const result = await generateText({
      ...aiModel('reasoning'),
      prompt: rendered,
    })

    review = reviewSchema.parse(extractJson(result.text))
  } catch (err) {
    await logAIError({ source: 'streaks:new', stage: 'review', message: (err as Error).message })
    spinner.stop('Review unavailable - keeping the rules as written')
    return details
  }

  if (review.status !== 'questions' || review.questions.length === 0) {
    const note = review.status === 'tight' && review.note ? `  ${colors.dim(review.note)}` : ''
    spinner.stop(colors.green('Rules look tight') + note)
    return details
  }

  const questions = review.questions.slice(0, 3)
  spinner.stop(colors.yellow(`${questions.length} question${questions.length === 1 ? '' : 's'} to tighten the rules`))

  const clarifications: Array<{ question: string; answer: string }> = []

  for (const q of questions) {
    const answer = await p.text({
      message: `${q.question}\n  ${colors.dim(q.why)}\n`,
      placeholder: 'Enter to skip',
      defaultValue: '',
    })

    // ESC = done reviewing; keep whatever was answered so far
    if (p.isCancel(answer)) break

    const trimmed = ((answer as string) ?? '').trim()
    if (!trimmed) continue // skipped - some questions are bad

    clarifications.push({ question: q.question, answer: trimmed })
  }

  if (clarifications.length === 0) return details

  const section = [
    '**Clarifications**',
    '',
    ...clarifications.map(({ question, answer }) => `- **${question}** ${answer}`),
  ].join('\n')

  return `${details.trim()}\n\n${section}`
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class StreaksNewTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:new',
    description: 'Create a new streak with AI-assisted clarification.',
    descriptionLong: [
      'Creates a new streak rule in streaks/active/.',
      'The AI pushes the habit until it is binary, small, and controllable,',
      'then proposes the title, slug, and why.',
    ],
    usage: [
      'sky streaks:new                       # Interactive AI-guided flow',
      'sky streaks:new --name eat-clean      # Override slug name',
      'sky streaks:new --schedule weekdays   # Skip the schedule prompt',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { name: overrideName, schedule: scheduleFlag, category } = args

    p.intro(colors.bold(colors.cyan('New Streak')))

    // stdin-free spinner: clack's spinner blocks stdin and starves the Ink prompts that follow
    const spinner = textSpinner()

    // Step 1: Gather the habit description (multiline - pasted blocks arrive intact)
    const log = (msg: string) => output.log(msg)
    const capturedBlocks: string[] = []

    const initialDescription = await promptMultiline({
      message: 'What habit do you want to build?',
      placeholder: 'e.g., "Eat clean - no sugar, no seed oils"',
    })

    if (initialDescription === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    echoCaptured(log, initialDescription)
    if (initialDescription.includes('\n')) capturedBlocks.push(initialDescription)

    // Step 2: Gather notebook context
    spinner.start('Gathering context...')
    const baseDir = config.DIR_BASE as string
    const { notebookContext, relCandidates } = await gatherNotebookContext(tasks, baseDir, initialDescription)
    spinner.stop(notebookContext ? colors.dim('Context loaded') : colors.dim('No additional context found'))

    // Step 3: Clarify until streak-worthy
    const clarifiedHabit = await clarifyHabit(initialDescription, spinner, log, capturedBlocks, notebookContext)

    if (clarifiedHabit === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 4: Schedule
    let schedule: StreakSchedule
    if (scheduleFlag === 'daily' || scheduleFlag === 'weekdays') {
      schedule = scheduleFlag
    } else {
      const selected = await p.select({
        message: 'How often?',
        options: [
          { value: 'daily', label: 'Daily', hint: 'every day, weekends included' },
          { value: 'weekdays', label: 'Weekdays', hint: 'Mon-Fri only' },
        ],
        initialValue: 'daily',
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      schedule = selected as StreakSchedule
    }

    // Step 5: When does it start? Creation day and start day are independent -
    // creating on a Sunday for a Monday start is the normal case.
    const now = await fetchNow()
    const today = now.plainDateTime.plainDate

    let startDay = today
    const startKind = await p.select({
      message: 'When does it start?',
      options: [
        { value: 'today', label: 'Today', hint: today.ymd },
        { value: 'tomorrow', label: 'Tomorrow' },
        { value: 'monday', label: 'Next Monday' },
        { value: 'date', label: 'On a date' },
      ],
      initialValue: 'today',
    })

    if (p.isCancel(startKind)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    if (startKind === 'tomorrow') {
      startDay = new PlainDate(dateFns.addDays(today.toDate(), 1))
    } else if (startKind === 'monday') {
      startDay = new PlainDate(dateFns.nextMonday(today.toDate()))
    } else if (startKind === 'date') {
      const dateInput = await p.text({
        message: 'Start on which date? (YYYY-MM-DD - a past date backfills from history)\n',
        placeholder: today.ymd,
        validate: (value) => {
          try {
            new PlainDate(value.trim())
          } catch {
            return 'Use YYYY-MM-DD'
          }
        },
      })

      if (p.isCancel(dateInput)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      startDay = new PlainDate((dateInput as string).trim())
    }

    // Step 6: When does it end? (planned end, stored as the inclusive `end` date)
    let end: PlainDate | undefined
    const endKind = await p.select({
      message: 'When does it end?',
      options: [
        { value: 'none', label: 'No end', hint: 'runs until archived' },
        { value: 'days', label: 'After a number of days' },
        { value: 'weeks', label: 'After a number of weeks' },
        { value: 'months', label: 'After a number of months' },
        { value: 'date', label: 'On a date', hint: 'tracked through that day' },
      ],
      initialValue: 'none',
    })

    if (p.isCancel(endKind)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    if (endKind === 'days' || endKind === 'weeks' || endKind === 'months') {
      const count = await p.text({
        message: `How many ${endKind}?\n`,
        placeholder: endKind === 'days' ? 'e.g., 30' : endKind === 'weeks' ? 'e.g., 6' : 'e.g., 3',
        validate: (value) => {
          const n = Number.parseInt(value, 10)
          if (!Number.isFinite(n) || n <= 0) return 'Enter a positive whole number'
        },
      })

      if (p.isCancel(count)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      end = plannedEndAfter(startDay, Number.parseInt(count as string, 10), endKind as PlannedEndUnit)
    } else if (endKind === 'date') {
      const dateInput = await p.text({
        message: 'Tracked through which date? (YYYY-MM-DD)\n',
        placeholder: `e.g., ${today.year}-12-31`,
        validate: (value) => {
          try {
            const picked = new PlainDate(value.trim())
            if (PlainDate.compare(picked, startDay) < 0) return 'That date is before the start'
          } catch {
            return 'Use YYYY-MM-DD'
          }
        },
      })

      if (p.isCancel(dateInput)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      end = new PlainDate((dateInput as string).trim())
    }

    if (end) {
      output.log(colors.dim(`  Tracked ${startDay.ymd} through ${end.ymd}`))
    }

    // Step 7: Optional freeform definition (the detailed rules), via the editor.
    // Blocks pasted during clarification become the seed - what you pasted is
    // what lands in the rule doc, ready to review.
    let details: string | undefined
    const hasPasted = capturedBlocks.length > 0
    const wantsDetails = await p.confirm({
      message: hasPasted
        ? 'Review the detailed rules now? (opens your editor, seeded with what you pasted)'
        : 'Write the detailed rules now? (opens your editor)',
      initialValue: hasPasted,
    })

    if (p.isCancel(wantsDetails)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    if (!wantsDetails && hasPasted) {
      // Editor declined but rules were pasted - keep them verbatim anyway
      details = capturedBlocks.join('\n\n')
    }

    if (wantsDetails) {
      const seed = hasPasted
        ? capturedBlocks.join('\n\n') + '\n'
        : [
            '<!-- Detailed rules for this streak - sections, bullets, anything.',
            '     Kept verbatim in the rule doc. Delete this comment. -->',
            '',
            '',
          ].join('\n')

      try {
        const edited = await editText(seed)
        const cleaned = stripEmbeddedComments(edited)
        details = cleaned || undefined
      } catch (err) {
        output.log(colors.yellow(`Editor failed (${(err as Error).message}) - continuing without details`))
      }
    }

    // Step 8: AI review of the rules - questions that make the streak completable
    if (details) {
      details = await reviewDetails(clarifiedHabit, schedule, details, spinner)
    }

    // Step 9: Format with AI - title, slug, why
    spinner.start('Formatting your streak...')

    const formatContent = await readTextFile(FORMAT_FILE)
    const formatInput: RenderInput = {
      streak: {
        description: clarifiedHabit,
        schedule,
        details,
        relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'streaks-format.prompt.md', formatInput)

    let aiResponse: z.infer<typeof formatSchema>

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedFormat,
      })

      aiResponse = formatSchema.parse(extractJson(result.text))
      spinner.stop('Streak formatted')
    } catch (err) {
      spinner.stop('Failed to format streak')
      await logAIError({ source: 'streaks:new', stage: 'format', message: (err as Error).message })
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format streak with AI')
    }

    // Step 10: Final name — every source passes through slugify so an AI- or
    // user-supplied value can't smuggle path separators into the filename
    const finalName =
      (overrideName ? slugify(overrideName, { preserveCase: true }) : '') ||
      slugify(aiResponse.slug, { suggestedLength: 20 }) ||
      slugify(clarifiedHabit, { suggestedLength: 20 })

    if (!finalName) {
      return CommandResult.fail('Could not derive a usable slug — rerun with --name')
    }

    const title = aiResponse.title

    // Only rel values the AI picked from the offered candidate list survive
    const rel = (aiResponse.rel ?? []).filter((r) => relCandidates.includes(r))

    // Step 11: Create the rule doc, stamp the start day, add the day item
    let written
    try {
      written = await writeStreak({
        name: finalName,
        title,
        schedule,
        start: startDay,
        end,
        why: aiResponse.why,
        details,
        rel,
        now,
        category,
      })
    } catch (err) {
      if (err instanceof SlugCollisionError || err instanceof TitleCollisionError) {
        output.error(`${err.message}. Pick another with --name.`)
        return CommandResult.fail(err.message)
      }
      throw err
    }

    output.log(colors.green(`\nCreated streak: ${written.file}`))

    if (written.stamped) {
      output.log(colors.gray(`Stamped "${title}" into the ${startDay.ymd} Streaks list`))
    } else if (written.stampWarning) {
      output.log(
        colors.yellow(`Note: no day file for ${startDay.ymd} yet - the item appears via week:new or day:start`),
      )
    }

    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    } else {
      output.log(colors.gray(`Added to ${category}: ${written.dayItem}`))
    }

    // Step 12: Open in editor
    try {
      openEditor([{ file: written.file }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Streak "${finalName}" created`))

    return CommandResult.success({ file: written.file, name: finalName })
  }
}
