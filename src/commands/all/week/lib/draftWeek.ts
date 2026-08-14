import * as path from 'node:path'
import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/render.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { formatPlanContext, type PlanContext } from './planContext.ts'
import { buildWeekFrontmatter, type Priority } from './weekMarkdown.ts'

const PROMPT_FILE = path.join(import.meta.dir, '..', 'prompts', 'plan.prompt.md')

export interface InterviewAnswers {
  /** The brain-dump: what the user wants to get done this week, one per entry */
  dump: string[]
  immovable?: string
  drop?: string
}

export interface LaterItems {
  professional: string[]
  personal: string[]
}

/**
 * Split the drafter's trailing `== WEEK-NEXT ==` block off the body — deferred
 * items routed to the next-* queues, never written into week.md itself.
 */
export function splitLaterBlock(text: string): { body: string; later: LaterItems } {
  const later: LaterItems = { professional: [], personal: [] }
  const marker = text.indexOf('== WEEK-NEXT ==')
  if (marker === -1) return { body: text.trim(), later }

  for (const line of text.slice(marker).split('\n').slice(1)) {
    const item = line.match(/^\s*(professional|personal):\s*(.+?)\s*$/i)
    if (item) later[item[1].toLowerCase() as keyof LaterItems].push(item[2])
  }
  return { body: text.slice(0, marker).trim(), later }
}

export interface RefineAnswer {
  question: string
  answer: string
}

/** The shared user-prompt bundle both the refiner and the drafter read. */
export function buildPlanUserPrompt(args: {
  week: Week
  createdYmd: string
  priorities: Priority[]
  context: PlanContext
  answers: InterviewAnswers
  refine?: RefineAnswer[]
}): string {
  const { week, createdYmd, priorities, context, answers, refine } = args
  const today = new PlainDate(createdYmd)

  const maintained = priorities.length
    ? priorities.map((p, i) => [`${i + 1}. ${p.text}`, ...p.why.map((why) => `   ${why}`)].join('\n')).join('\n')
    : '(none yet — this is the first planned week)'

  const interview =
    [
      answers.dump.length ? `Wants to get done this week:\n${answers.dump.map((d) => `- ${d}`).join('\n')}` : undefined,
      answers.immovable && `Immovable this week: ${answers.immovable}`,
      answers.drop && `To drop or push: ${answers.drop}`,
    ]
      .filter(Boolean)
      .join('\n') || '(interview skipped)'

  const sections = [
    `Target: week.md for ${week.toString()} (${week.start.dayShort} ${week.start.ymd} – ${week.end.dayShort} ${week.end.ymd}).`,
    `Today is ${today.dayShort} ${today.ymd}.`,
    '',
    '== INTERVIEW ANSWERS ==',
    interview,
  ]

  if (refine?.length) {
    sections.push('', '== REFINE ANSWERS ==')
    for (const { question, answer } of refine) sections.push(`Q: ${question}`, `A: ${answer}`)
  }

  sections.push(
    '',
    '== MAINTAINED PRIORITY STACK (from last week) ==',
    maintained,
    '',
    '== NOTEBOOK CONTEXT ==',
    formatPlanContext(context),
  )

  return sections.join('\n')
}

/** Models sometimes wrap the file in a fence despite instructions — unwrap it. */
export function stripCodeFence(md: string): string {
  const fenced = md.trim().match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return fenced ? fenced[1] : md.trim()
}

/** A draft is usable when it is the file we asked for, not prose about one. */
export function isValidDraft(md: string, week: Week): boolean {
  return (
    md.startsWith(`# ${week.toString()}`) &&
    md.includes('## Summary') &&
    md.includes('## Priorities') &&
    md.includes('### Professional') &&
    md.includes('### Personal') &&
    !md.includes('(PRIORITY)') &&
    !md.includes('(GOAL)')
  )
}

/**
 * Assemble the final file from model output: lift the `summary:` first line
 * into code-built frontmatter (generic line when the model forgot it), split
 * the trailing WEEK-NEXT block off for the queues, keep the body only when it
 * honors the contract.
 */
export function assembleWeekFile(
  modelOutput: string,
  week: Week,
  createdYmd: string,
): { file: string; later: LaterItems } | undefined {
  const text = stripCodeFence(modelOutput)
  const summaryLine = text.match(/^summary:\s*(.+?)\s*\n+/)
  const summary = summaryLine ? summaryLine[1] : `Week plan for ${week.toString()}`
  const { body, later } = splitLaterBlock(summaryLine ? text.slice(summaryLine[0].length) : text)
  if (!isValidDraft(body, week)) return undefined
  return { file: `${buildWeekFrontmatter(createdYmd, summary)}\n${body}\n`, later }
}

/**
 * Draft the full week.md from the interview + notebook context. Returns
 * undefined on any failure — the caller falls back to the plain template;
 * planning never blocks on the AI.
 */
export async function draftWeekMarkdown(args: {
  week: Week
  priorities: Priority[]
  context: PlanContext
  answers: InterviewAnswers
  refine: RefineAnswer[]
  createdYmd: string
}): Promise<{ file: string; later: LaterItems } | undefined> {
  try {
    const { output: system } = renderPromptFile(await readTextFile(PROMPT_FILE), 'plan.prompt.md')
    const result = await generateText({ ...aiModel('reasoning'), system, prompt: buildPlanUserPrompt(args) })
    return assembleWeekFile(result.text, args.week, args.createdYmd)
  } catch {
    return undefined
  }
}
