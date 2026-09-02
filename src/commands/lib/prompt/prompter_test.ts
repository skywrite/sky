import * as config from '#config'
import { assert, test } from '#test'
import CommandContext from '../core/CommandContext.ts'
import type { FormAnswers, FormPrompt, Prompter } from './Prompter.ts'
import { UnattendedPrompter } from './UnattendedPrompter.ts'

const FORM: FormPrompt = {
  title: 'Review',
  items: [{ id: '0', label: 'Name spelling', problem: 'Jan Doh', contexts: [], occurrences: 1, alternatives: [] }],
}

test('UnattendedPrompter', async () => {
  const prompter = new UnattendedPrompter()
  const answers = await Promise.all([
    prompter.text({ message: 'Any corrections?' }),
    prompter.confirm({ message: 'Sure?' }),
    prompter.select({ message: 'Pick', options: [{ value: 'a', label: 'A' }] }),
    prompter.multiselect({ message: 'Pick', options: [{ value: 'a', label: 'A' }] }),
    prompter.form(FORM),
  ])
  assert({
    given: 'nobody to answer',
    should: 'say so and answer null to every question',
    actual: { interactive: prompter.interactive, answers },
    expected: { interactive: false, answers: [null, null, null, null, null] },
  })
})

test('CommandContext: the prompter seam', async () => {
  const context = CommandContext.test(config)
  const answers: FormAnswers = { '0': { action: 'accept', value: 'Jane Doe' } }
  const scripted: Prompter = {
    interactive: true,
    text: () => Promise.resolve('rel: Quantum Labs'),
    confirm: () => Promise.resolve(true),
    select: () => Promise.resolve('a'),
    multiselect: () => Promise.resolve(['0']),
    form: () => Promise.resolve(answers),
  }
  const forked = context.fork({ prompt: scripted })
  assert({
    given: 'a test context',
    should: 'be unattended',
    actual: context.prompt.interactive,
    expected: false,
  })
  assert({
    given: 'a fork with a scripted prompter',
    should: 'answer through it, and keep it through a further fork',
    actual: [forked.prompt.interactive, await forked.prompt.form(FORM), forked.fork({}).prompt === scripted],
    expected: [true, answers, true],
  })
  assert({
    given: 'the original context after forking',
    should: 'still be unattended',
    actual: context.prompt.interactive,
    expected: false,
  })
})
