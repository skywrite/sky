import * as p from '@clack/prompts'
import colors from 'picocolors'
import { isTerminal } from '#shared/sys/mod.ts'
import type {
  ConfirmPrompt,
  FormAnswers,
  FormItem,
  FormPrompt,
  MultiselectPrompt,
  PlaceAnswer,
  PlacePrompt,
  Prompter,
  SelectPrompt,
  TextPrompt,
} from './Prompter.ts'

/**
 * The terminal answers: every question is a clack prompt. A form is asked
 * one item at a time — the problem, its sentences, a select of the
 * replacements plus "type your own", "skip" and "quit" — which is how the
 * transcript review has always read in the terminal.
 */
export class ClackPrompter implements Prompter {
  /** A pipe or a service has no keyboard; then every question answers null, as headless runs do. */
  readonly interactive = isTerminal()

  async text(prompt: TextPrompt): Promise<string | null> {
    if (!this.interactive) return null
    for (const line of prompt.hint ?? []) console.log(colors.gray(`  ${line}`))
    const answer = await p.text({
      message: prompt.message,
      placeholder: prompt.placeholder,
      defaultValue: prompt.initial,
    })
    if (p.isCancel(answer)) return null
    return String(answer ?? '').trim()
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean | null> {
    if (!this.interactive) return null
    const answer = await p.confirm({ message: prompt.message, initialValue: prompt.initial })
    return p.isCancel(answer) ? null : Boolean(answer)
  }

  async select(prompt: SelectPrompt): Promise<string | null> {
    if (!this.interactive) return null
    const answer = await p.select({
      message: prompt.message,
      options: prompt.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
      initialValue: prompt.initial,
    })
    return p.isCancel(answer) ? null : String(answer)
  }

  async multiselect(prompt: MultiselectPrompt): Promise<string[] | null> {
    if (!this.interactive) return null
    const answer = await p.multiselect({
      message: prompt.message,
      options: prompt.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
      initialValues: prompt.initial,
      required: false,
    })
    return p.isCancel(answer) ? null : (answer as string[])
  }

  // The terminal has no room to move each item, so it stays the multiselect
  // it has always been: tick what you accept, and each one takes the when
  // it arrived with. The hint says where that is.
  async place(prompt: PlacePrompt): Promise<PlaceAnswer | null> {
    if (!this.interactive) return null
    const answer = await p.multiselect({
      message: prompt.message,
      options: prompt.items.map((item) => ({ value: item.value, label: item.label, hint: item.hint })),
      initialValues: prompt.initial,
      required: false,
    })
    if (p.isCancel(answer)) return null
    const ticked = new Set(answer as string[])
    return prompt.items.filter((item) => ticked.has(item.value)).map((item) => ({ value: item.value, when: item.when }))
  }

  async form(prompt: FormPrompt): Promise<FormAnswers | null> {
    if (!this.interactive) return null
    const answers: FormAnswers = {}
    if (prompt.items.length === 0) return answers

    p.intro(colors.bold(prompt.title))
    if (prompt.intro) console.log(colors.gray(`  ${prompt.intro}`))

    for (let i = 0; i < prompt.items.length; i++) {
      const item = prompt.items[i]
      console.log(renderItem(item, i, prompt.items.length))

      const options: { value: string; label: string; hint?: string }[] = []
      if (item.suggestion)
        options.push({ value: `accept:${item.suggestion}`, label: item.suggestion, hint: 'suggested' })
      for (const alt of item.alternatives) {
        if (alt !== item.suggestion) options.push({ value: `accept:${alt}`, label: alt, hint: 'alternative' })
      }
      options.push({ value: 'custom', label: 'Enter custom text...', hint: 'type your own' })
      options.push({ value: 'skip', label: 'Skip this issue', hint: 'leave unchanged' })
      options.push({ value: 'quit', label: 'Quit review', hint: 'stop reviewing' })

      const selection = await p.select({ message: 'Select correction:', options })
      if (p.isCancel(selection)) {
        p.cancel('Review cancelled')
        break
      }
      const chosen = String(selection)
      if (chosen === 'quit') {
        p.log.warn('Quitting review early...')
        break
      }
      if (chosen === 'skip') {
        answers[item.id] = { action: 'skip' }
        p.log.info(colors.dim('Skipped'))
        continue
      }
      if (chosen === 'custom') {
        const typed = await p.text({
          message: 'Enter your correction:',
          placeholder: item.suggestion || item.problem,
        })
        if (p.isCancel(typed) || !typed) {
          answers[item.id] = { action: 'skip' }
          p.log.info(colors.dim('Skipped'))
        } else {
          answers[item.id] = { action: 'custom', value: String(typed) }
          p.log.success(`Custom: ${typed}`)
        }
        continue
      }
      const value = chosen.replace(/^accept:/, '')
      answers[item.id] = { action: 'accept', value }
      p.log.success(`Accepted: ${value}`)
    }

    const all = Object.values(answers)
    const applied = all.filter((a) => a.action !== 'skip').length
    const skipped = all.filter((a) => a.action === 'skip').length
    p.outro(`Review complete: ${applied} applied, ${skipped} skipped`)
    return answers
  }
}

/** One item as the terminal shows it: its place in the list, the sentences, the problem, the suggestion. */
function renderItem(item: FormItem, index: number, total: number): string {
  const lines = ['', colors.dim(`─── Issue ${index + 1} of ${total} ───`), '', colors.bold(colors.yellow(item.label))]
  if (item.contexts.length > 0) {
    lines.push('', colors.dim(item.contexts.length > 1 ? 'Contexts:' : 'Context:'))
    for (const context of item.contexts) lines.push(`  ${context}`)
  }
  lines.push(
    '',
    colors.dim('Problem:'),
    `  ${colors.red(item.problem)}${item.occurrences > 1 ? colors.dim(` ×${item.occurrences}`) : ''}`,
  )
  if (item.suggestion) {
    lines.push('', colors.dim('AI Suggestion:'), `  ${colors.green(item.suggestion)}`)
  }
  return lines.join('\n')
}
