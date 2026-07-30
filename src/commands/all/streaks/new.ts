import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import colors from 'picocolors'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { DIR_STREAKS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { fetchNow, readDay, writeDay } from '#shared/nbfs/mod.ts'
import StreakDocument, { type StreakSchedule } from '#shared/models/Streak/mod.ts'
import { loadAllStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import slugify from '#lib/string/slugify.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import * as dateFns from '#universal/dates/dateFns/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { promptMultiline } from '#lib/tui/MultilineTextPrompt.tsx'
import { textSpinner, type TextSpinner } from '#lib/tui/textSpinner.ts'
import { editText, stripEmbeddedComments } from './lib/editText.ts'
import { plannedEndAfter, type PlannedEndUnit } from './lib/plannedEnd.ts'

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
  category: Flag.string('Category for day item: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${val} Complete`,
    default: () => 'Personal Complete',
  }),
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

type ClarifierResult =
  | { status: 'clear'; habit: string; summary: string }
  | { status: 'unclear'; question: string; reason: string }

/** Strip markdown code fences from AI response text. */
function stripCodeFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return cleaned
}

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
 * Returns the clarified habit statement, or null if the user cancels.
 * Multi-line answers (pasted rule blocks) are collected into capturedBlocks
 * so the details step can seed the editor with them.
 */
async function clarifyHabit(
  initialInput: string,
  spinner: TextSpinner,
  log: (msg: string) => void,
  capturedBlocks: string[],
): Promise<string | null> {
  const clarifierContent = await readTextFile(CLARIFIER_FILE)
  let currentInput = initialInput
  let conversationHistory = ''

  for (let round = 0; round < MAX_CLARIFICATION_ROUNDS; round++) {
    spinner.start('Thinking about your habit...')

    const clarifierInput: RenderInput = {
      clarifier: {
        currentInput,
        conversationHistory: conversationHistory || undefined,
      },
    }

    const { output: renderedClarifier } = renderPromptFile(
      clarifierContent,
      'streaks-clarifier.prompt.md',
      clarifierInput,
    )

    let clarifierResult: ClarifierResult

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedClarifier,
      })

      clarifierResult = JSON.parse(stripCodeFences(result.text))
    } catch {
      spinner.stop('Clarification failed')
      return currentInput
    }

    if (clarifierResult.status === 'clear') {
      spinner.stop(colors.green('Habit is streak-worthy'))

      const confirmed = await p.confirm({
        message: `${colors.bold('Habit:')} ${clarifierResult.habit}\n\n  ${colors.dim(
          clarifierResult.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return clarifierResult.habit
      }

      // clack p.text on purpose: this edits the one-line habit statement, and
      // an Ink prompt must never follow a clack prompt on the same stdin
      // (clack's readline leaves the stream in a state that starves Ink's
      // reads under bun). Multi-line pasting lives in the answer prompts.
      const edited = await p.text({
        message: 'How would you describe the habit?\n',
        initialValue: clarifierResult.habit,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // Habit is unclear - ask the clarifying question
    spinner.stop(colors.dim(clarifierResult.reason))

    const answer = await promptMultiline({
      message: clarifierResult.question,
      placeholder: 'Your answer - pasted blocks arrive intact...',
    })

    if (answer === null) {
      return null
    }

    echoCaptured(log, answer)
    if (answer.includes('\n')) capturedBlocks.push(answer)

    conversationHistory += `\nAI asked: "${clarifierResult.question}"\nUser answered: "${answer}"`
    currentInput = `${currentInput}\n\nClarification: ${answer}`
  }

  // Max rounds reached - proceed with what we have
  return currentInput
}

interface ReviewQuestion {
  question: string
  why: string
}

type ReviewResult = { status: 'tight'; note?: string } | { status: 'questions'; questions: ReviewQuestion[] }

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

  let review: ReviewResult
  try {
    const reviewContent = await readTextFile(REVIEW_FILE)
    const { output: rendered } = renderPromptFile(reviewContent, 'streaks-review.prompt.md', {
      review: { habit, schedule, details },
    })

    const result = await generateText({
      ...aiModel('reasoning'),
      prompt: rendered,
    })

    review = JSON.parse(stripCodeFences(result.text))
  } catch {
    spinner.stop('Review unavailable - keeping the rules as written')
    return details
  }

  if (review.status !== 'questions' || !Array.isArray(review.questions) || review.questions.length === 0) {
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

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
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

    // Step 2: Clarify until streak-worthy
    const clarifiedHabit = await clarifyHabit(initialDescription, spinner, log, capturedBlocks)

    if (clarifiedHabit === null) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Step 3: Schedule
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

    // Step 4: When does it start? Creation day and start day are independent -
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

    // Step 5: When does it end? (planned end, stored as the inclusive `end` date)
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

    // Step 6: Optional freeform definition (the detailed rules), via the editor.
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

    // Step 7: AI review of the rules - questions that make the streak completable
    if (details) {
      details = await reviewDetails(clarifiedHabit, schedule, details, spinner)
    }

    // Step 8: Format with AI - title, slug, why
    spinner.start('Formatting your streak...')

    const formatContent = await readTextFile(FORMAT_FILE)
    const formatInput: RenderInput = {
      streak: {
        description: clarifiedHabit,
        schedule,
        details,
      },
    }

    const { output: renderedFormat } = renderPromptFile(formatContent, 'streaks-format.prompt.md', formatInput)

    let aiResponse: { title: string; slug: string; why: string }

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: renderedFormat,
      })

      aiResponse = JSON.parse(stripCodeFences(result.text))
      spinner.stop('Streak formatted')
    } catch (err) {
      spinner.stop('Failed to format streak')
      output.error(`AI Error: ${(err as Error).message}`)
      return CommandResult.error(err as Error, 'Failed to format streak with AI')
    }

    // Step 9: Final name + collision checks
    const finalName = overrideName ?? aiResponse.slug ?? slugify(clarifiedHabit, { suggestedLength: 20 })
    const title = aiResponse.title ?? finalName

    const existing = await loadAllStreaks()
    const nameTaken = existing.find(({ streak }) => streak.name === finalName)
    if (nameTaken) {
      output.error(`A streak named "${finalName}" already exists (${nameTaken.status}). Pick another with --name.`)
      return CommandResult.fail(`Streak "${finalName}" already exists`)
    }

    // Titles are the join key in day files - they must be unique among active streaks
    const titleTaken = existing.find(({ streak, status }) => status === 'active' && streak.title === title)
    if (titleTaken) {
      output.error(`Active streak "${titleTaken.streak.name}" already uses the title "${title}".`)
      return CommandResult.fail(`Title "${title}" already in use`)
    }

    // Step 10: Create and write the rule doc
    const streak = StreakDocument.create({
      name: finalName,
      title,
      schedule,
      start: startDay,
      end,
      why: aiResponse.why,
      details,
    })

    const streakPath = path.join(DIR_STREAKS, 'active', `${finalName}.md`)
    if (await exists(streakPath)) {
      output.error(`File already exists: ${streakPath}`)
      return CommandResult.fail('Streak file already exists')
    }

    await outputFile(streakPath, streak.toMarkdown())
    output.log(colors.green(`\nCreated streak: ${streakPath}`))

    // Step 11: Stamp the start day's file so the item shows up immediately -
    // its day file may already exist even for a future start (week:new runs ahead)
    try {
      const dayModel = await readDay(startDay)
      const stamped = stampStreaksList(dayModel, [streak], startDay)
      if (stamped !== dayModel) {
        await writeDay(stamped)
        output.log(colors.gray(`Stamped "${title}" into the ${startDay.ymd} Streaks list`))
      }
    } catch {
      output.log(
        colors.yellow(`Note: no day file for ${startDay.ymd} yet - the item appears via week:new or day:start`),
      )
    }

    // Step 12: Add day item (on the creation day - starting later is part of the record)
    const startsNote = startDay.ymd === today.ymd ? '' : ` (starts ${startDay.ymd})`
    const dayItem = `${now.plainDateTime.time} > streaks/${finalName} -> Started | ${title}${startsNote}`
    try {
      await writeDayItems(today, category, dayItem)
      output.log(colors.gray(`Added to ${category}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    // Step 13: Open in editor
    try {
      openEditor([{ file: streakPath }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Streak "${finalName}" created`))

    return CommandResult.success({ file: streakPath, name: finalName })
  }
}
