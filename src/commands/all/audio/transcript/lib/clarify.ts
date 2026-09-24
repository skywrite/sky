/**
 * A few questions after the write-up check, so the notes say what was said
 * and what was meant. Each question is drafted knowing the answers before
 * it. Each can be skipped. Esc in the terminal, or Skip the rest on the
 * page, ends them. There are never more than three.
 *
 * What was answered is folded into the write-up, marked as clarified after
 * the meeting. What was skipped stays as heard.
 *
 * A question is only ever about the meeting as it happened: decided or
 * thought aloud, which reading was meant, what a referent was, something
 * the write-up missed. Never what should happen next, never the clock.
 * The prompts say so. This file keeps the count, the skips, and the record.
 */

import { generateText } from 'ai'
import colors from 'picocolors'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { fetchOrgs, fetchPeople, fetchProjects } from './entityLists.ts'
import { glossaryKeywords, loadGlossary } from './glossary.ts'
import { clockLabel, type Exchange, type TranscriptRun } from './transcriptRun.ts'

export const MAX_QUESTIONS = 3
/** Draft calls a run may spend: the questions, plus a couple thrown away for being about a name */
const MAX_DRAFTS = MAX_QUESTIONS + 2

/** What the notebook already knows by name; a question is never about these */
export interface KnownNames {
  people: string[]
  orgs: string[]
  projects: string[]
  terms: string[]
}

const NO_NAMES: KnownNames = { people: [], orgs: [], projects: [], terms: [] }

/** The next question, and the words it is about */
export interface NextQuestion {
  quote: string
  question: string
}

export interface DraftInput {
  transcript: string
  summary: string
  exchange: Exchange[]
  /** The known names that appear in the words */
  known: KnownNames
}

export interface FoldInput {
  summary: string
  /** The answered questions only */
  exchange: Exchange[]
}

/** Where the step reports: a stage line, and plain lines */
interface Reporter {
  stage(id: string, label: string, detail?: string | null): void
  log(line: string): void
}

export interface ClarifyInput {
  /** The corrected words the questions are about */
  transcript: string
  /** The write-up as the check left it */
  summary: string
  prompt: Prompter
  output: Reporter
  /** The run record, when the file has one: the exchange is kept there as it goes */
  run: TranscriptRun | null
  /** The notebook's clock, for the "reused" line */
  now: () => string
  /** What the notebook knows by name; `loadKnownNames` gets it */
  known?: KnownNames
  signal?: AbortSignal
  /** The model calls; a test scripts them */
  draft?: (input: DraftInput, signal?: AbortSignal) => Promise<NextQuestion | null>
  fold?: (input: FoldInput, signal?: AbortSignal) => Promise<string>
}

export interface ClarifyResult {
  exchange: Exchange[]
  /** The write-up to file: folded when something was answered, else as it came */
  summary: string
  folded: boolean
}

const PROMPTS = {
  question: new URL('../prompts/transcript-question.prompt.md', import.meta.url).pathname,
  fold: new URL('../prompts/transcript-fold.prompt.md', import.meta.url).pathname,
}

export async function clarify(input: ClarifyInput): Promise<ClarifyResult> {
  const { prompt, output, run, signal } = input
  const draft = input.draft ?? draftWithModel
  const fold = input.fold ?? foldWithModel

  // Asked and settled by an earlier run of the same file: nothing is asked twice.
  const kept = run ? await run.get('questions') : null
  if (kept?.data.done) {
    output.log(colors.gray(`Questions from ${clockLabel(kept.at, input.now())}, reused.`))
    const summary = kept.data.summary ?? input.summary
    return { exchange: kept.data.exchange, summary, folded: kept.data.summary !== null }
  }
  if (!prompt.interactive) return { exchange: kept?.data.exchange ?? [], summary: input.summary, folded: false }

  const exchange: Exchange[] = kept ? [...kept.data.exchange] : []
  const keep = async (done: boolean, summary: string | null = null) => {
    if (run) await run.put('questions', { exchange, summary, done })
  }

  output.stage('questions', 'A few questions')
  const known = knownInWords(input.known ?? NO_NAMES, `${input.transcript}\n${input.summary}`)
  let ended = false
  let drafts = 0
  while (exchange.length < MAX_QUESTIONS && drafts < MAX_DRAFTS && !signal?.aborted) {
    let next: NextQuestion | null
    try {
      drafts++
      next = await draft({ transcript: input.transcript, summary: input.summary, exchange, known }, signal)
    } catch (err) {
      if (signal?.aborted) break
      const message = (err as Error).message
      output.log(colors.yellow(`Couldn't draft a question: ${message}`))
      await logAIError({ source: 'audio:transcript:clarify', stage: 'question', message })
      break
    }
    if (!next) break
    // Names were settled before this step; a question about one is never asked.
    if (isKnownName(next.quote, known)) {
      output.log(colors.gray(`Dropped a question about a known name: ${next.quote}`))
      continue
    }
    const answer = await prompt.text({
      message: next.question,
      hint: [`“${next.quote}”`, 'Enter skips this one · Esc ends the questions'],
      placeholder: 'A phrase is enough',
    })
    // Esc, or Skip the rest: the questions end here.
    if (answer === null) {
      ended = true
      break
    }
    exchange.push({ quote: next.quote, question: next.question, answer: answer.trim() || null })
    await keep(false)
  }
  if (signal?.aborted) return { exchange, summary: input.summary, folded: false }

  const answered = exchange.filter((e) => e.answer !== null)
  if (answered.length === 0) {
    await keep(true)
    const why = exchange.length === 0 && !ended ? 'Nothing to ask.' : 'Nothing answered; the notes stay as heard.'
    output.log(colors.gray(why))
    return { exchange, summary: input.summary, folded: false }
  }

  output.log(colors.cyan('\nFolding your answers into the write-up…'))
  let summary: string
  try {
    summary = await fold({ summary: input.summary, exchange: answered }, signal)
    if (!plausible(summary, input.summary)) throw new Error('the folded write-up came back empty or shortened')
  } catch (err) {
    if (signal?.aborted) return { exchange, summary: input.summary, folded: false }
    const message = (err as Error).message
    // The person's answers are never lost: they go under their own heading instead.
    output.log(colors.yellow(`Couldn't fold the answers in: ${message}. They go under their own heading.`))
    await logAIError({ source: 'audio:transcript:clarify', stage: 'fold', message })
    summary = appended(input.summary, answered)
  }
  await keep(true, summary)
  return { exchange, summary, folded: true }
}

/** A fold rewrites; it does not shrink the notes to a fragment or drop the sections. */
function plausible(folded: string, original: string): boolean {
  return folded.trim().length >= Math.floor(original.trim().length * 0.6) && folded.includes('## ')
}

/** The answers as a section of their own, when the model could not fold them in. */
export function appended(summary: string, answered: Exchange[]): string {
  const lines = answered.map((e) => `- ${e.question}\n  ${e.answer}. Clarified after the meeting.`)
  return `${summary.trimEnd()}\n\n## Clarified after the meeting\n${lines.join('\n')}\n`
}

/** Every known name, from the notebook service and the glossary; empty lists when either is away. */
export async function loadKnownNames(today: string): Promise<KnownNames> {
  const names = (lines: string) =>
    lines
      .split('\n')
      .map((line) => line.replace(/\s*\(\d+\)\s*$/, '').trim())
      .filter(Boolean)
  const [people, orgs, projects, glossary] = await Promise.all([
    fetchPeople(today).catch(() => ''),
    fetchOrgs().catch(() => ''),
    fetchProjects().catch(() => ''),
    loadGlossary().catch(() => null),
  ])
  return {
    people: names(people),
    orgs: names(orgs),
    projects: names(projects),
    terms: glossary ? glossaryKeywords(glossary) : [],
  }
}

/** The known names that appear in the words, each list in its own order. */
export function knownInWords(known: KnownNames, words: string): KnownNames {
  const text = words.toLowerCase()
  const present = (list: string[]) => list.filter((name) => name.trim() !== '' && text.includes(name.toLowerCase()))
  return {
    people: present(known.people),
    orgs: present(known.orgs),
    projects: present(known.projects),
    terms: present(known.terms),
  }
}

/**
 * Whether a question's quote is a known name and nothing else. Exact, so an
 * organization named like a common word cannot swallow a question about the
 * word; the prompt's rule covers a name inside a longer quote.
 */
export function isKnownName(quote: string, known: KnownNames): boolean {
  const q = quote
    .replace(/[“”"']/g, '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[.,;:!?]+$/, '')
  if (q === '') return false
  return [...known.people, ...known.orgs, ...known.projects, ...known.terms].some((name) => {
    const n = name.trim().toLowerCase()
    return n !== '' && (q === n || q === `${n}s` || q === `${n}’s`)
  })
}

/** The known names in the words, as the prompt reads them. */
export function knownText(known: KnownNames): string {
  const lines = [
    ...known.people.map((n) => `- ${n} (person)`),
    ...known.orgs.map((n) => `- ${n} (organization)`),
    ...known.projects.map((n) => `- ${n} (project)`),
    ...known.terms.map((n) => `- ${n} (term)`),
  ]
  return lines.length > 0 ? lines.join('\n') : '(none)'
}

/** The exchange as the prompts read it. */
export function exchangeText(exchange: Exchange[]): string {
  if (exchange.length === 0) return '(none yet)'
  return exchange
    .map((e, i) => `${i + 1}. About: “${e.quote}”\n   Q: ${e.question}\n   A: ${e.answer ?? '(skipped)'}`)
    .join('\n\n')
}

async function draftWithModel(input: DraftInput, signal?: AbortSignal): Promise<NextQuestion | null> {
  const content = await readPromptFile(PROMPTS.question)
  const { output: prompt } = renderPromptFile(content, 'transcript-question.prompt.md', {
    user: { input: input.transcript },
    writeup: { text: input.summary },
    known: { text: knownText(input.known) },
    exchange: { text: exchangeText(input.exchange), count: String(input.exchange.length), max: String(MAX_QUESTIONS) },
  })
  const result = await generateText({ ...aiModel('reasoning'), abortSignal: signal, prompt })
  const parsed = extractJson<{ question?: unknown; quote?: unknown }>(result.text)
  if (typeof parsed.question !== 'string' || parsed.question.trim() === '') return null
  const quote = typeof parsed.quote === 'string' ? parsed.quote.trim() : ''
  return { quote, question: parsed.question.trim() }
}

async function foldWithModel(input: FoldInput, signal?: AbortSignal): Promise<string> {
  const content = await readPromptFile(PROMPTS.fold)
  const { output: prompt } = renderPromptFile(content, 'transcript-fold.prompt.md', {
    user: { input: input.summary },
    exchange: { text: exchangeText(input.exchange) },
  })
  const result = await generateText({ ...aiModel('reasoning'), abortSignal: signal, prompt })
  return result.text.trim()
}
