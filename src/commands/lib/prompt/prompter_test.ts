import * as config from '#config'
import { assert, test } from '#test'
import CommandContext from '../core/CommandContext.ts'
import { EventPrompter } from '../core/runCommand.ts'
import type { FormAnswers, FormPrompt, PlacePrompt, Prompter } from './Prompter.ts'
import { UnattendedPrompter } from './UnattendedPrompter.ts'

const FORM: FormPrompt = {
  title: 'Review',
  items: [{ id: '0', label: 'Name spelling', problem: 'Jan Doh', contexts: [], occurrences: 1, alternatives: [] }],
}

const PLACE: PlacePrompt = {
  message: 'Accept action items',
  items: [{ value: '0', label: 'Send the sheet', mine: true, when: { date: '2026-03-12', time: null } }],
  initial: ['0'],
  today: '2026-03-11',
  createdThrough: '2026-03-15',
  fallback: { date: '2026-03-12', time: null },
  waiting: 3,
}

test('UnattendedPrompter', async () => {
  const prompter = new UnattendedPrompter()
  const answers = await Promise.all([
    prompter.text({ message: 'Any corrections?' }),
    prompter.confirm({ message: 'Sure?' }),
    prompter.select({ message: 'Pick', options: [{ value: 'a', label: 'A' }] }),
    prompter.multiselect({ message: 'Pick', options: [{ value: 'a', label: 'A' }] }),
    prompter.place(PLACE),
    prompter.form(FORM),
  ])
  assert({
    given: 'nobody to answer',
    should: 'say so and answer null to every question',
    actual: { interactive: prompter.interactive, answers },
    expected: { interactive: false, answers: [null, null, null, null, null, null] },
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
    place: () => Promise.resolve([{ value: '0', when: { date: null, time: null } }]),
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

test('EventPrompter: a place question travels as an event and its reply is the answer', async () => {
  const pushed: { kind: string; reply: (answer: unknown) => void }[] = []
  const prompter = new EventPrompter((event) => pushed.push({ kind: event.request.kind, reply: event.reply }))
  const asked = prompter.place(PLACE)
  const answer = [{ value: '0', when: { date: '2026-03-13', time: '09:30' } }]
  pushed[0].reply(answer)
  assert({
    given: 'a place question and a host that moves the item to Friday morning',
    should: 'push a place event and resolve with the moved placement',
    actual: [pushed.map((e) => e.kind), await asked],
    expected: [['place'], answer],
  })
})
