import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Prompter, TextPrompt } from '#commands/lib/prompt/Prompter.ts'
import { UnattendedPrompter } from '#commands/lib/prompt/UnattendedPrompter.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import {
  appended,
  clarify,
  type DraftInput,
  type FoldInput,
  isKnownName,
  knownInWords,
  type NextQuestion,
} from './clarify.ts'
import { TranscriptRun } from './transcriptRun.ts'

const NOW = '2026-01-27 09:31'
const TRANSCRIPT = 'I want to move the whole launch. Or I wanted to. Alex said maybe go back to the Friday demos.'
const SUMMARY =
  '# Launch talk\n\n## Meeting Summary\nA talk about the launch.\n\n## Loose Ends\n- "I want to move the whole launch" — intention, no plan.\n- "maybe go back to the Friday demos" — unclear what Alex meant.\n'
const QUESTIONS: NextQuestion[] = [
  { quote: 'I want to move the whole launch', question: 'Decided, or still a thought?' },
  { quote: 'the whole launch', question: 'The public launch, or just the beta?' },
  { quote: 'maybe go back to the Friday demos', question: 'Was Alex talking about the demos for the whole team?' },
  { quote: 'never asked', question: 'A fourth question that must never come' },
]

/** A person at the keyboard with the answers decided in advance; null is Esc. */
function person(answers: Array<string | null>): Prompter & { asked: TextPrompt[] } {
  const asked: TextPrompt[] = []
  const nobody = new UnattendedPrompter()
  return {
    interactive: true,
    asked,
    text: (prompt) => {
      asked.push(prompt)
      return Promise.resolve(answers.length > 0 ? (answers.shift() as string | null) : null)
    },
    confirm: (prompt) => nobody.confirm(prompt),
    select: (prompt) => nobody.select(prompt),
    multiselect: (prompt) => nobody.multiselect(prompt),
    place: (prompt) => nobody.place(prompt),
    form: (prompt) => nobody.form(prompt),
  }
}

function quiet() {
  const lines: string[] = []
  const stages: string[] = []
  return {
    lines,
    stages,
    output: {
      stage: (id: string) => void stages.push(id),
      log: (line: string) => void lines.push(line),
    },
  }
}

/** The model calls, scripted: one question per call from the list, then the fold's own reply. */
function model(folded = 'FOLDED') {
  const drafts: DraftInput[] = []
  const folds: FoldInput[] = []
  return {
    drafts,
    folds,
    draft: (input: DraftInput) => {
      drafts.push({ ...input, exchange: input.exchange.map((e) => ({ ...e })) })
      return Promise.resolve(QUESTIONS[drafts.length - 1] ?? null)
    },
    fold: (input: FoldInput) => {
      folds.push(input)
      return Promise.resolve(folded.padEnd(SUMMARY.length, '\n## Folded\n'))
    },
  }
}

async function record() {
  const root = await makeTempDir()
  const memo = path.join(root, 'memo.m4a')
  await writeFile(memo, 'the same bytes')
  return TranscriptRun.forFile(memo, { dir: path.join(root, 'runs'), now: () => NOW })
}

test('clarify() — three at most, each drafted with the answers so far, the answered ones folded in', async () => {
  const run = await record()
  const m = model()
  const { output, stages } = quiet()
  const result = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['Decided.', '', 'Just the beta.']),
    output,
    run,
    now: () => NOW,
    draft: m.draft,
    fold: m.fold,
  })
  const kept = await run.get('questions')
  assert({
    given: 'answers to the first and third questions, the second skipped',
    should: 'draft three questions, each knowing the answers before it, fold the two answers in, and keep the exchange',
    actual: {
      stages,
      drafted: m.drafts.map((d) => d.exchange.map((e) => e.answer)),
      folded: m.folds.map((f) => f.exchange.map((e) => e.answer)),
      result: {
        folded: result.folded,
        summary: result.summary.slice(0, 6),
        answers: result.exchange.map((e) => e.answer),
      },
      kept: {
        done: kept?.data.done,
        answers: kept?.data.exchange.map((e) => e.answer),
        summary: kept?.data.summary?.slice(0, 6),
      },
    },
    expected: {
      stages: ['questions'],
      drafted: [[], ['Decided.'], ['Decided.', null]],
      folded: [['Decided.', 'Just the beta.']],
      result: { folded: true, summary: 'FOLDED', answers: ['Decided.', null, 'Just the beta.'] },
      kept: { done: true, answers: ['Decided.', null, 'Just the beta.'], summary: 'FOLDED' },
    },
  })
})

test('clarify() — every question skipped: no fold, the write-up as it came', async () => {
  const run = await record()
  const m = model()
  const { output } = quiet()
  const result = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['', '', '']),
    output,
    run,
    now: () => NOW,
    draft: m.draft,
    fold: m.fold,
  })
  const kept = await run.get('questions')
  assert({
    given: 'Enter on all three',
    should: 'ask no fourth, call no fold, keep the write-up, and record the questions as done',
    actual: {
      drafts: m.drafts.length,
      folds: m.folds.length,
      summary: result.summary === SUMMARY,
      done: kept?.data.done,
      summaryKept: kept?.data.summary,
    },
    expected: { drafts: 3, folds: 0, summary: true, done: true, summaryKept: null },
  })
})

test('clarify() — Esc ends the questions; what was answered still folds', async () => {
  const m = model()
  const { output } = quiet()
  const result = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['Decided.', null]),
    output,
    run: null,
    now: () => NOW,
    draft: m.draft,
    fold: m.fold,
  })
  assert({
    given: 'one answer, then Esc',
    should: 'stop asking, and fold the one answer',
    actual: { drafts: m.drafts.length, answers: result.exchange.map((e) => e.answer), folded: result.folded },
    expected: { drafts: 2, answers: ['Decided.'], folded: true },
  })
})

test('clarify() — nobody there, or nothing to ask', async () => {
  const m = model()
  const { output } = quiet()
  const unattended = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: new UnattendedPrompter(),
    output,
    run: null,
    now: () => NOW,
    draft: m.draft,
    fold: m.fold,
  })
  const none = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['never used']),
    output,
    run: null,
    now: () => NOW,
    draft: () => Promise.resolve(null),
    fold: m.fold,
  })
  assert({
    given: 'an unattended run, and a run where the model finds nothing worth asking',
    should: 'ask nothing and file the write-up as it came',
    actual: {
      unattended: { drafts: m.drafts.length, folded: unattended.folded, same: unattended.summary === SUMMARY },
      none: { asked: none.exchange.length, folded: none.folded, same: none.summary === SUMMARY },
    },
    expected: { unattended: { drafts: 0, folded: false, same: true }, none: { asked: 0, folded: false, same: true } },
  })
})

test('clarify() — a settled record is reused, never re-asked', async () => {
  const run = await record()
  await run.put('questions', {
    exchange: [{ quote: 'the whole launch', question: 'Decided?', answer: 'Decided.' }],
    summary: 'FOLDED EARLIER',
    done: true,
  })
  const m = model()
  const { output, lines } = quiet()
  const result = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['never used']),
    output,
    run,
    now: () => '2026-01-27 10:00',
    draft: m.draft,
    fold: m.fold,
  })
  assert({
    given: 'a run whose questions were answered and folded earlier',
    should: 'reuse the folded write-up and say when it was kept',
    actual: {
      drafts: m.drafts.length,
      summary: result.summary,
      folded: result.folded,
      line: lines[0]?.includes('09:31'),
    },
    expected: { drafts: 0, summary: 'FOLDED EARLIER', folded: true, line: true },
  })
})

test('clarify() — a fold that comes back empty lands the answers under their own heading', async () => {
  const m = model()
  const { output } = quiet()
  const result = await clarify({
    transcript: TRANSCRIPT,
    summary: SUMMARY,
    prompt: person(['Decided.']),
    output,
    run: null,
    now: () => NOW,
    draft: (input) => Promise.resolve(input.exchange.length === 0 ? QUESTIONS[0] : null),
    fold: () => Promise.resolve(''),
  })
  assert({
    given: 'a model that returns nothing for the fold',
    should: 'keep the write-up and add the answer as its own section',
    actual: result.summary,
    expected: appended(SUMMARY, [{ ...QUESTIONS[0], answer: 'Decided.' }]),
  })
  assert({
    given: 'the fallback section',
    should: 'carry the question, the answer, and the mark',
    actual: result.summary.endsWith(
      '## Clarified after the meeting\n- Decided, or still a thought?\n  Decided.. Clarified after the meeting.\n',
    ),
    expected: true,
  })
})

const KNOWN = {
  people: ['Alex Chen', 'Jane Doe'],
  orgs: ['Atlas', 'Quantum Labs'],
  projects: ['Beta Launch'],
  terms: ['Friday demos'],
}

test('knownInWords() and isKnownName() — what the words mention, and what a quote is', () => {
  const found = knownInWords(KNOWN, 'Alex said the Atlas deal moves. The Friday demos too.')
  assert({
    given: 'the known names and some words',
    should: 'keep only the names the words mention',
    actual: found,
    expected: { people: [], orgs: ['Atlas'], projects: [], terms: ['Friday demos'] },
  })
  assert({
    given: 'quotes that are a name and nothing else, a name inside a phrase, and something else',
    should: 'call only the bare names, so a name like a common word cannot swallow a real question',
    actual: [
      isKnownName('“Sam Rivera”', { ...KNOWN, people: ['Sam Rivera'] }),
      isKnownName('the Atlas.', KNOWN),
      isKnownName('board readiness with Atlas', KNOWN),
      isKnownName('the budget figure', { ...KNOWN, orgs: ['Figure'] }),
      isKnownName('I want to move the whole launch', KNOWN),
    ],
    expected: [true, true, false, false, false],
  })
})

test('clarify() — a question drafted about a known name is dropped, and the drafter sees the names', async () => {
  const drafts: DraftInput[] = []
  const script: Array<NextQuestion | null> = [
    { quote: 'the Atlas', question: 'What does "the Atlas" refer to here?' },
    QUESTIONS[0],
    null,
  ]
  const m = model()
  const { output, lines } = quiet()
  const result = await clarify({
    transcript: 'The Atlas deal. I want to move the whole launch.',
    summary: SUMMARY,
    prompt: person(['Decided.']),
    output,
    run: null,
    now: () => NOW,
    known: KNOWN,
    draft: (input) => {
      drafts.push(input)
      return Promise.resolve(script.shift() ?? null)
    },
    fold: m.fold,
  })
  assert({
    given: 'a first draft about a known organization, then a real question',
    should: 'drop the first without asking, ask the second, and hand the drafter the names in the words',
    actual: {
      asked: result.exchange.map((e) => e.question),
      known: drafts[0]?.known,
      dropped: lines.some((l) => l.includes('Dropped a question about a known name: the Atlas')),
    },
    expected: {
      asked: ['Decided, or still a thought?'],
      known: { people: [], orgs: ['Atlas'], projects: [], terms: ['Friday demos'] },
      dropped: true,
    },
  })
})
