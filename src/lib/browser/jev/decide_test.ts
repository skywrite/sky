import { assert, test } from '#test'
import { type AskJev, decide, JevAnswerError, type LooseAnswer } from './decide.ts'
import type { ActionTable } from './table.ts'

const table: ActionTable = {
  url: 'https://atlas.example/documents',
  title: 'Atlas Brokerage',
  text: 'Documents Tax year 2024 Tax year 2025',
  above: 0,
  below: 0,
  omitted: 0,
  rows: [
    {
      index: 0,
      ref: 'e3',
      role: 'link',
      name: 'Download',
      flags: [],
      near: 'Tax year 2024:',
      kind: 'click',
      secret: false,
    },
    {
      index: 1,
      ref: 'e4',
      role: 'link',
      name: 'Download',
      flags: [],
      near: 'Tax year 2025:',
      kind: 'click',
      secret: false,
    },
    {
      index: 2,
      ref: 'e5',
      role: 'combobox',
      name: 'Year',
      flags: [],
      kind: 'select',
      options: ['2024', '2025'],
      value: '2024',
      secret: false,
    },
  ],
}

const pick = (choice: string, others: string[] = []): LooseAnswer => ({
  choice,
  probabilities:
    others.length === 0
      ? { [choice]: 1 }
      : { [choice]: 0.9, ...Object.fromEntries(others.map((o) => [o, 0.1 / others.length])) },
  confidence: 0.9,
})
const scripted =
  (answers: Record<string, LooseAnswer>): AskJev =>
  async () => ({ model: 'jev-test', answers, usage: { input_tokens: 500, output_tokens: 0 } })

test('a click decision names the row Jev picked and carries the gates', async () => {
  const decision = await decide({
    goal: 'download the 2025 form',
    table,
    history: [],
    ask: scripted({
      operation: pick('click', ['done']),
      click_target: pick('t1', ['t0']),
      select_target: pick('none'),
      option_t2: pick('2025'),
      needs_person: { noul: 0.05 },
      done: { noul: 0.02 },
      risky: { noul: 0.1 },
    }),
    now: (() => {
      let t = 0
      return () => (t += 120)
    })(),
  })
  assert({
    given: 'operation click with target t1',
    should: 'resolve to the 2025 row with its probabilities',
    actual: {
      operation: decision.operation,
      target: decision.target?.near,
      p: decision.targetProbability,
      gates: [decision.needsPerson, decision.done, decision.risky],
      ms: decision.ms,
    },
    expected: { operation: 'click', target: 'Tax year 2025:', p: 0.9, gates: [0.05, 0.02, 0.1], ms: 120 },
  })
})

test('a target of none turns into blocked, and a select carries its option', async () => {
  const blocked = await decide({
    goal: 'g',
    table,
    history: [],
    ask: scripted({
      operation: pick('click'),
      click_target: pick('none', ['t0']),
      select_target: pick('none'),
      option_t2: pick('2025'),
      needs_person: { noul: 0 },
      done: { noul: 0 },
      risky: { noul: 0 },
    }),
  })
  assert({
    given: 'click with no fitting target',
    should: 'become blocked with a note',
    actual: [blocked.operation, blocked.note],
    expected: ['blocked', 'Jev chose click but no control fit it.'],
  })
  const select = await decide({
    goal: 'g',
    table,
    history: [],
    ask: scripted({
      operation: pick('select'),
      click_target: pick('none'),
      select_target: pick('t2'),
      option_t2: pick('2025', ['2024']),
      needs_person: { noul: 0 },
      done: { noul: 0 },
      risky: { noul: 0 },
    }),
  })
  assert({
    given: 'select on the Year dropdown',
    should: 'carry the chosen option',
    actual: [select.operation, select.target?.name, select.option],
    expected: ['select', 'Year', '2025'],
  })
})

test('answers that are not answers are refused before anything runs', async () => {
  const cases: [string, Record<string, LooseAnswer>][] = [
    [
      'an option that was not offered',
      { operation: pick('fly'), needs_person: { noul: 0 }, done: { noul: 0 }, risky: { noul: 0 } },
    ],
    [
      'probabilities that do not sum to one',
      {
        operation: { choice: 'click', probabilities: { click: 0.5, done: 0.1 }, confidence: 0.5 },
        click_target: pick('t1'),
        needs_person: { noul: 0 },
        done: { noul: 0 },
        risky: { noul: 0 },
      },
    ],
    [
      'a choice that is not the most likely',
      {
        operation: { choice: 'click', probabilities: { click: 0.3, done: 0.7 }, confidence: 0.5 },
        click_target: pick('t1'),
        needs_person: { noul: 0 },
        done: { noul: 0 },
        risky: { noul: 0 },
      },
    ],
  ]
  for (const [given, answers] of cases) {
    const outcome = await decide({ goal: 'g', table, history: [], ask: scripted(answers) }).then(
      () => 'decided',
      (error: unknown) => (error instanceof JevAnswerError ? 'refused' : 'other'),
    )
    assert({ given, should: 'be refused as a JevAnswerError', actual: outcome, expected: 'refused' })
  }
})
