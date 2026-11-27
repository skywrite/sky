import * as path from 'node:path'
import { streamText } from 'ai'
import { z } from 'zod'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { gatherNotebookContext } from '#commands/lib/interview.ts'
import {
  type ContextFile,
  formatSections,
  readDayJournals,
  readDayNarration,
  readGoals,
  readInForceDecisions,
  readPendingDecisions,
  readRecentlyDecided,
} from '#commands/lib/notebookContext.ts'
import { DIR_BASE, DIR_TIME } from '#config'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel, getProfile, roleProfile } from '#shared/ai/models.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { listDayChats } from '#shared/models/Chat/ChatStore/mod.ts'
import { dayAIChatsDir, fetchNow } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile, type RenderInput } from '#shared/prompts/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { effortLevels } from '#universal/ai/effort.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { DecidingPlan, Find, WizardPlan } from './plan.ts'
import type { ReadCounts, ThinkStage } from './session.ts'
import {
  optionKey,
  toDecidedPlan,
  toDecidingPlan,
  toFinds,
  wantKey,
  WireDecided,
  WireDeciding,
  WireFinds,
  WireOptionExtension,
  WireWantExtension,
  withOption,
  withWant,
} from './wire.ts'

/**
 * Sky's thinking for the decision wizard. A decision is thought through once,
 * on the reasoning model at the most effort it offers, and the wizard then
 * walks the person through the result without another model call. Only an
 * option or a want the person types in sends Sky back to think.
 *
 * These are model calls with no notebook writes, so they are plain functions
 * the Future handler calls, like the Most Important suggestions. They are not
 * commands: a new command cannot be run in-process until the command manifest
 * is rebuilt on every machine.
 */

export interface DecisionThinking {
  /** Decisions the last two weeks of the notebook point to; `known` are the ones already written down. */
  find(input: { known: string[] }): Promise<Find[]>
  /** The whole plan for one decision. `related` is the notebook text it rests on, kept for later additions. */
  plan(
    input: { statement: string; why?: string; decided: boolean },
    progress: (stage: ThinkStage, read?: ReadCounts) => void,
  ): Promise<{ plan: WizardPlan; read: ReadCounts; related: string }>
  /** An option the person typed in, worked out like the others and ranked among them. */
  addOption(input: { plan: DecidingPlan; title: string; text: string; related: string }): Promise<DecidingPlan>
  /** A want the person typed in, with its effect on every option. */
  addWant(input: { plan: DecidingPlan; title: string; text: string }): Promise<DecidingPlan>
}

/** How far back Sky reads the person's days, and how much of that text it may carry. */
const RECENT_DAYS = 14
const RECENT_CHARS = 240_000
/** With no look-back day from the model, three months is long enough for most results to show. */
const LOOK_BACK_DAYS = 90

const promptFile = (name: string) =>
  new URL(`../../commands/all/decisions/prompts/${name}.prompt.md`, import.meta.url).pathname

async function render(name: string, input: RenderInput): Promise<string> {
  return renderPromptFile(await readPromptFile(promptFile(name)), `${name}.prompt.md`, input).output
}

/** The reasoning model at the most effort it offers: "max" where the model has it. */
function fullEffort() {
  const levels = effortLevels(getProfile(roleProfile('reasoning')))
  return levels.length ? { effort: levels.at(-1)! } : {}
}

/**
 * The shape of the answer, given to the model in words. A plan is too large for
 * a provider's constrained structured output, so the schema travels as the
 * contract and the answer is checked against it when it comes back.
 */
const contract = (schema: z.ZodType): string =>
  [
    '## The shape of your answer',
    'Return one JSON object and nothing else: no text before it, no text after it, no code fence.',
    'It must match this JSON Schema. The descriptions say how many items a list should hold and how long a line should be.',
    JSON.stringify(z.toJSONSchema(schema)),
  ].join('\n\n')

/** One answer, streamed so a long think keeps its connection and can say when it starts to write. */
async function think<T>(
  source: string,
  schema: z.ZodType<T>,
  prompt: string,
  { full, writing }: { full: boolean; writing?: () => void },
): Promise<T> {
  return runWithUsageSource(source, async () => {
    const result = streamText({
      ...aiModel('reasoning', full ? fullEffort() : undefined),
      prompt: `${prompt}\n\n${contract(schema)}`,
      onError: () => {},
    })
    let receiving = false
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error
      if (!receiving && part.type === 'text-delta') {
        receiving = true
        writing?.()
      }
    }
    return schema.parse(extractJson(await result.text))
  })
}

const files = (list: ContextFile[]): string | undefined =>
  list.length
    ? formatSections(list.map((file) => ({ title: path.relative(DIR_BASE, file.path), body: file.body })))
    : undefined
const nameOf = (file: ContextFile): string => path.basename(file.path, '.md')

const optionLines = (plan: DecidingPlan): string =>
  plan.options.map((option, at) => `${optionKey(at)}: ${option.title}. ${option.why}`).join('\n')

/**
 * The person's recent days, newest first: each day's summary (or its day file),
 * its journal entries, and the titles of its chats. The search for decisions
 * reads this, and so does the plan: the notes where a decision came up are
 * the evidence it most needs, and a search by topic does not always find them.
 */
async function recentDays(today: PlainDate): Promise<{ text: string | undefined; notes: number }> {
  const sections: Array<{ title: string; body: string }> = []
  let used = 0
  let notes = 0
  for (let back = 0; back < RECENT_DAYS && used < RECENT_CHARS; back++) {
    const day = today.addDays(-back)
    const [narration, journals, chats] = await Promise.all([
      readDayNarration(day),
      readDayJournals(day),
      listDayChats(path.join(DIR_TIME, dayAIChatsDir(day))).catch(() => []),
    ])
    const parts = [
      ...(narration
        ? [`(${narration.kind === 'summary' ? 'summary of the day' : 'day file'})\n${narration.body}`]
        : []),
      ...journals.map((journal) => `(journal)\n${journal.body}`),
      ...(chats.some((chat) => chat.summary)
        ? [`(chats that day)\n${chats.flatMap((chat) => (chat.summary ? [`- ${chat.summary}`] : [])).join('\n')}`]
        : []),
    ]
    if (!parts.length) continue
    // The newest days come first, so a full budget drops the oldest text.
    const body = truncate(parts.join('\n\n'), RECENT_CHARS - used, '…')
    sections.push({ title: `${day.ymd} (${day.dayLong})`, body })
    used += body.length
    notes += journals.length + (narration ? 1 : 0)
  }
  return { text: sections.length ? formatSections(sections) : undefined, notes }
}

export function createDecisionThinking(tasks: () => CommandService): DecisionThinking {
  const days = async () => {
    const today = (await fetchNow()).plainDateTime.plainDate
    return { today, fallback: today.addDays(LOOK_BACK_DAYS).ymd }
  }
  return {
    async find({ known }) {
      const { today } = await days()
      const recent = await recentDays(today)
      // A notebook with no recent days has nothing to find, and no reason to ask a model.
      if (!recent.text) return []
      const prompt = await render('decisions-find', {
        context: { notebookDate: today.ymd },
        notebook: {
          known: known.length ? known.map((title) => `- ${title}`).join('\n') : undefined,
          days: recent.text,
        },
      })
      return toFinds(await think('future:decision-find', WireFinds, prompt, { full: false }))
    },

    async plan({ statement, why, decided }, progress) {
      progress('reading')
      const { today, fallback } = await days()
      const [goals, inForce, pending, recentlyDecided, related, recent] = await Promise.all([
        readGoals(),
        readInForceDecisions(),
        readPendingDecisions(),
        readRecentlyDecided(today),
        gatherNotebookContext(tasks(), DIR_BASE, statement, today),
        recentDays(today),
      ])
      const read = {
        goals: goals.length,
        inForce: inForce.length,
        notes: (related.notebookContext?.match(/<!-- START FILE -->/g) ?? []).length + recent.notes,
      }
      progress('thinking', read)
      const references = [
        ...goals.map((goal) => `goals/${nameOf(goal)}`),
        ...inForce.map((decision) => `decisions/${nameOf(decision)}`),
        ...recentlyDecided.map((decision) => `decisions/${nameOf(decision)}`),
        ...related.relCandidates,
      ]
      const prompt = await render(decided ? 'decisions-recall' : 'decisions-weigh', {
        context: { notebookDate: today.ymd },
        user: { dayOfWeek: today.dayLong },
        decision: { statement, why: why || undefined },
        notebook: {
          goals: files(goals),
          inForce: files(inForce),
          pending: files(pending),
          recentlyDecided: files(recentlyDecided),
          related: related.notebookContext,
          recent: recent.text,
          references: references.length ? [...new Set(references)].join('\n') : undefined,
        },
      })
      const writing = () => progress('writing', read)
      const plan: WizardPlan = decided
        ? toDecidedPlan(
            await think('future:decision-recall', WireDecided, prompt, { full: true, writing }),
            today.ymd,
            fallback,
          )
        : toDecidingPlan(
            await think('future:decision-weigh', WireDeciding, prompt, { full: true, writing }),
            today.ymd,
            fallback,
          )
      // What a later addition is worked out against: the same notes this plan rested on.
      const evidence = [related.notebookContext, recent.text].filter(Boolean).join('\n\n')
      return { plan, read, related: evidence }
    },

    async addOption({ plan, title, text, related }) {
      const { today, fallback } = await days()
      const prompt = await render('decisions-weigh-option', {
        context: { notebookDate: today.ymd },
        user: { dayOfWeek: today.dayLong },
        decision: {
          title,
          context: plan.context,
          wants: plan.wants.map((want, at) => `${wantKey(at)}: ${want.title}`).join('\n'),
          options: optionLines(plan),
          added: text,
          key: optionKey(plan.options.length),
        },
        notebook: { related: related || undefined },
      })
      return withOption(
        plan,
        await think('future:decision-weigh-option', WireOptionExtension, prompt, { full: true }),
        today.ymd,
        fallback,
      )
    },

    async addWant({ plan, title, text }) {
      const prompt = await render('decisions-weigh-want', {
        decision: {
          title,
          context: plan.context,
          options: optionLines(plan),
          added: text,
          key: wantKey(plan.wants.length),
        },
      })
      return withWant(plan, await think('future:decision-weigh-want', WireWantExtension, prompt, { full: true }))
    },
  }
}
