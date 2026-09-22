import * as p from '@clack/prompts'
import { readMultiline } from '#commands/all/mi/_lib/readMultiline.ts'
import type { CommandContext } from '#commands/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createMostImportantAI, miSuggestionsPrompt } from './ai.ts'
import { miMarkdown } from './document.ts'
import type { MIAnswer, MIDraft, MISuggestion } from './types.ts'

export interface SuggestResult {
  summary: string
  markdown: string
  dueBy?: string
  draft?: MIDraft
}

interface SuggestOptions {
  context: CommandContext
  today: PlainDate
  time?: string
  initialSummary?: string
  dryRun?: boolean
  inspect?: boolean
  depend?: boolean
}

/** Terminal presentation of the same suggest, interview, and review steps as the day page. */
export async function suggestMostImportant(opts: SuggestOptions): Promise<SuggestResult> {
  const {
    today,
    context: { output },
  } = opts
  const empty = { summary: '', markdown: '' }
  const ai = createMostImportantAI()
  if (opts.inspect) {
    const file = `/tmp/mi-suggest-prompt-${today.ymd}.md`
    await writeTextFile(file, await miSuggestionsPrompt(today, { time: opts.time }))
    openEditor([{ file }])
    return empty
  }
  const spinner = p.spinner()
  async function generate<T>(message: string, run: () => Promise<T>): Promise<T | null> {
    while (true) {
      spinner.start(message)
      try {
        const value = await run()
        spinner.stop('Ready')
        return value
      } catch (error) {
        spinner.stop(error instanceof Error ? error.message : 'Sky could not finish that step.')
        const retry = await p.confirm({ message: 'Try again? Your answers are still here.', initialValue: true })
        if (p.isCancel(retry) || !retry) return null
      }
    }
  }
  let selected = opts.initialSummary ?? ''
  let suggestions: MISuggestion[] = []
  let visible = 3
  if (!selected) {
    const first = await generate('Finding useful priorities...', () => ai.suggest(today))
    if (!first) return empty
    suggestions = first.suggestions
    output.log(first.contextSummary)
  }
  if (opts.dryRun) {
    if (selected) output.log(selected)
    for (const [index, item] of suggestions.entries()) output.log(`${index + 1}. ${item.summary}\n   ${item.reason}`)
    return empty
  }
  while (!selected) {
    const choice = await p.select({
      message: 'Choose your Most Important:',
      options: [
        ...suggestions.slice(0, visible).map((item, index) => ({
          value: index,
          label: `${index + 1}. ${item.summary}`,
          hint: `${index === 0 ? 'Recommended · ' : ''}${item.reason}`,
        })),
        { value: -1, label: 'Write your own' },
        { value: -2, label: 'More suggestions' },
        { value: -3, label: 'Give Sky some direction' },
      ],
    })
    if (p.isCancel(choice)) return empty
    if (choice === -1) {
      const value = await readMultiline('What do you want to accomplish?')
      if (value === null) return empty
      selected = value
    } else if (choice === -2 || choice === -3) {
      if (choice === -2 && visible < suggestions.length) {
        visible = suggestions.length
        continue
      }
      const feedback = choice === -3 ? await readMultiline('What should Sky focus on?') : undefined
      if (feedback === null) return empty
      const next = await generate('Finding different priorities...', () =>
        ai.suggest(today, { previous: suggestions, feedback }),
      )
      if (!next) continue
      suggestions = choice === -3 ? next.suggestions : [...suggestions, ...next.suggestions]
      visible = choice === -3 ? 3 : suggestions.length
      output.log(next.contextSummary)
    } else selected = suggestions[choice].summary
  }
  const answers: MIAnswer[] = []
  while (true) {
    // An object distinguishes a ready-to-draft null question from cancellation.
    const result = await generate('Thinking through this task...', async () => ({
      question: await ai.question(today, { statement: selected, answers }),
    }))
    if (!result) return empty
    if (!result.question) break
    const answer = await readMultiline(
      result.question,
      'Write your answer, then press Enter 3 times. Leave empty to draft with what we have.',
    )
    if (answer === null) return empty
    if (!answer) break
    answers.push({ question: result.question, answer })
  }
  const firstDraft = await generate('Writing your task...', () => ai.draft(today, { statement: selected, answers }))
  if (!firstDraft) return empty
  let draft: MIDraft = firstDraft
  while (true) {
    output.log(`\n# ${draft.summary}\n${draft.dueBy ? `\nDue: ${draft.dueBy}\n` : ''}\n${draft.body}`)
    const choice = await p.select({
      message: 'Review your most important task:',
      options: [
        { value: 'save', label: 'Add to day' },
        { value: 'refine', label: 'Refine with Sky' },
        { value: 'title', label: 'Edit title' },
        { value: 'body', label: 'Edit document' },
        { value: 'cancel', label: 'Cancel' },
      ],
    })
    if (p.isCancel(choice) || choice === 'cancel') return empty
    if (choice === 'save')
      return {
        summary: draft.summary,
        dueBy: draft.dueBy || undefined,
        draft,
        markdown: miMarkdown(draft),
      }
    if (choice === 'title') {
      const title = await p.text({ message: 'Task title', initialValue: draft.summary })
      if (!p.isCancel(title) && title.trim()) draft = { ...draft, summary: title.trim() }
    } else if (choice === 'body') {
      const body = await readMultiline('Enter the revised document. Leave empty to keep the current version.')
      if (body) draft = { ...draft, body }
    } else {
      const feedback = await readMultiline('What should change?')
      if (!feedback) continue
      const previous = draft
      const refined = await generate('Refining your task...', () =>
        ai.draft(today, { statement: selected, answers, previous, feedback }),
      )
      if (refined) draft = refined
    }
  }
}
