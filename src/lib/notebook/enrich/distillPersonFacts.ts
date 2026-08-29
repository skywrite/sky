import { generateObject } from 'ai'
import { z } from 'zod'
import { fetchPeopleIndex, readServiceDocument } from '#lib/service/documents.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel, type Role } from '#shared/ai/models.ts'
import { MAX_OVERVIEW_LINES, MAX_WORDS_PER_LINE } from '#shared/models/Person/format.ts'
import {
  findPersonSubjects,
  type PersonIndexEntry,
  type PersonSubject,
  screenUnlisted,
} from '#shared/models/Person/subjects.ts'
import { APPEND_SECTIONS, FILL_FIELDS, type PersonFacts, type UnlistedPerson } from '#shared/models/Person/write.ts'
import { normalizeEntityName } from './resolve.ts'
import { fetchEntityScores } from './scores.ts'

// The save-time person-facts distiller: reads the finished conversation
// against the current profiles of the people it mentions and decides what
// the CRM should learn. The calibration lives in the prompt's bar — most
// conversations teach NOTHING about a person, and profiles hold who someone
// IS, never what merely happened (the meeting/chat/message docs already
// record that). Applying the ops, the caps, the format law, and the
// never-delete-unquoted guarantees all live in models/Person/write.ts and
// format.ts (design: models/Person/docs/README.md); this module only asks
// the model.

// generateObject has no timeout option; an unbounded call can hang forever.
const AI_TIMEOUT_MS = 60_000

const LINE_RULE = `one fact, at most ${MAX_WORDS_PER_LINE} words, no semicolons`

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('overview'),
    lines: z
      .array(z.string().describe(LINE_RULE))
      .describe(
        `the full replacement ## Overview, ${MAX_OVERVIEW_LINES} lines at most, every still-true fact carried over`,
      ),
  }),
  z.object({
    op: z.literal('note'),
    section: z.enum(APPEND_SECTIONS),
    text: z.string().describe(`${LINE_RULE}; a fact that stays true, appended forever`),
  }),
  z.object({
    op: z.literal('replace'),
    section: z.enum(APPEND_SECTIONS),
    old: z.string().describe('the existing line, quoted exactly as the profile has it, without its list marker'),
    text: z.string().describe(`the corrected line: ${LINE_RULE}`),
  }),
  z.object({ op: z.literal('field'), field: z.enum(FILL_FIELDS), value: z.string() }),
  z.object({ op: z.literal('site'), url: z.string().describe('a URL that clearly belongs to this person') }),
  z.object({
    op: z.literal('preferred-name'),
    preferred: z.string().describe('only on explicit evidence: "goes by", "call me", a stated correction'),
  }),
])

export type PersonDistillInput = {
  /** The packed conversation transcript */
  transcript: string
  /** The discovered people and their current profiles */
  subjects: PersonSubject[]
  /** YYYY-MM-DD, anchoring any "currently"/"as of" phrasing */
  today: string
  /** The user's speaker label — never a subject or an unlisted entry */
  userLabel: string
  /** What is being distilled, in the model's words — e.g. 'AI chat conversation' */
  kind?: string
}

export interface PersonDistillResult {
  facts: PersonFacts[]
  unlisted: UnlistedPerson[]
}

/** A distillation plus the subjects it saw — what an applier needs, whole. */
export interface PersonFactsDistillation extends PersonDistillResult {
  subjects: PersonSubject[]
}

/**
 * The full front half of person curation over any finished text — chat
 * transcript, meeting summary: service-backed subject discovery (the whole
 * people index, ranked by the service's interaction scores so a bare first
 * name surfaces the likely namesakes), then the distill call. Service
 * trouble degrades to no subjects and the distiller still runs for its
 * unlisted lane; the caller applies the result via applyPersonFacts. The
 * user is never their own subject.
 */
export async function distillPersonFactsFromText(
  input: { text: string; today: string; userLabel: string; kind: string },
  role: Role = 'fast',
): Promise<PersonFactsDistillation | undefined> {
  let index: PersonIndexEntry[] = []
  let subjects: PersonSubject[] = []
  try {
    const [people, scores] = await Promise.all([fetchPeopleIndex(), fetchEntityScores()])
    index = people
    subjects = await findPersonSubjects({
      transcript: input.text,
      index,
      readDocument: readServiceDocument,
      excludeNames: [input.userLabel],
      scoreFor: (name) => scores?.get(normalizeEntityName(name)) ?? 0,
    })
  } catch {
    subjects = []
  }
  const result = await distillPersonFacts(
    { transcript: input.text, subjects, today: input.today, userLabel: input.userLabel, kind: input.kind },
    role,
  )
  // Screen against the same index discovery ran over. Empty when the service
  // was unreachable — then nothing can be reported as existing and the lane
  // falls back to person:new hints, which is all it could ever say blind.
  return result ? { subjects, facts: result.facts, unlisted: screenUnlisted(result.unlisted, index) } : undefined
}

function profileBlock(subject: PersonSubject): string {
  return `<profile name="${subject.name}">\n${subject.markdown.trim()}\n</profile>`
}

/**
 * The prompt, in the model's words. Format numbers come from format.ts, so
 * tweaking a cap there changes what the model is asked for and what the
 * applier accepts in one move.
 */
export function personFactsPrompt(input: { kind: string; userLabel: string; today: string; profiles: string }): string {
  const user = input.userLabel
  return [
    `You curate the person profiles — the CRM — of a personal markdown notebook. Below are a finished ${input.kind} and the current profiles of the people it may mention. Decide what those profiles should learn and return the operations.`,
    '',
    'THE BAR — most conversations teach nothing about a person:',
    '- Return ZERO ops for a person unless the conversation materially discussed them or revealed durable facts about them. A passing mention teaches nothing.',
    '- The profiles are candidates matched by name, not conclusions: a bare first name in the conversation lists the likeliest profile answering to it — two when their standing with the user is close — and the person meant may be none of them. Attribute a mention to a profile only when its org, role, or history fits the conversation; when it is unclear which person is meant, write nothing about them — no ops and no unlisted entry.',
    "- Profiles hold who a person IS: identity, role, history, family, preferences — what makes them legible in future conversations. The notebook's meetings, messages, and chats already record what HAPPENED; never copy event minutiae into a profile.",
    "- Never invent. Every fact must come from the transcript or from the person's current profile.",
    '',
    'FORMAT — a reader with no patience takes each line in at a glance:',
    `- One fact per line. At most ${MAX_WORDS_PER_LINE} words. No semicolons. No dashes joining clauses. No lists inside a line.`,
    '- Plain words. Present tense for what is true now, past tense for history.',
    '- A line that breaks these rules is refused, so split a long thought into two lines.',
    '',
    'Operations (name each person exactly as their profile is listed):',
    `- overview: the full replacement ## Overview, ${MAX_OVERVIEW_LINES} lines at most. It answers "who is this and where do things stand": role and org, how they connect to ${user}, where the relationship or engagement stands now, a candid read worth keeping. It REPLACES the current Overview, so carry over every fact still true from it, reworded freely, one per line. Recent events and the current state belong here and nowhere else. Omit it when the picture has not changed.`,
    `- note: one fact that will stay true, appended to a section forever. Background: origin story, how they met ${user}, career history. Family: spouse, children, birthdays, anniversaries. Info: lasting miscellany — how a name is pronounced, quirks, standing preferences. Never a status, a plan, or something that happened; that is overview material.`,
    '- replace: correct a line in Background, Family, or Info that the conversation shows is wrong or stale. Quote the old line exactly as the profile has it, without its list marker, and give the corrected line. Nothing outside those three sections is editable.',
    '- field: fill an empty frontmatter field (location, title, org) the conversation establishes. When the overview states a role, org, or location and that field is empty, send this too.',
    '- site: a URL that clearly belongs to the person (their site, their LinkedIn).',
    '- preferred-name: ONLY on explicit evidence — "goes by", "call me", a stated correction. Never infer from usage alone.',
    '',
    `unlisted: a person the conversation materially discussed who has NO profile below — someone ${user} personally knows or dealt with (met, emailed, works with), with a one-line gist. People only: a company, product, protocol, team, or place is never a person and never belongs here. Never ${user} themself, never the AI assistant, never public figures merely referenced. Give the name alone, with no role or qualifier in parentheses.`,
    '',
    `Today is ${input.today}.`,
    '',
    '<profiles>',
    input.profiles,
    '</profiles>',
  ].join('\n')
}

/**
 * Ask the model what the person profiles should learn from this
 * conversation. Returns undefined on model error — the save proceeds
 * without profile ops, mirroring the other enrichers' abstain behavior.
 */
export async function distillPersonFacts(
  input: PersonDistillInput,
  role: Role = 'fast',
): Promise<PersonDistillResult | undefined> {
  if (!input.transcript.trim()) return undefined
  const kind = input.kind ?? 'conversation'
  const profiles =
    input.subjects.length > 0
      ? input.subjects.map(profileBlock).join('\n\n')
      : '(no existing profiles matched this conversation)'

  try {
    const { object } = await generateObject({
      ...aiModel(role),
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      schema: z.object({
        people: z
          .array(
            z.object({
              name: z.string().describe('exactly as a listed profile names them'),
              ops: z.array(opSchema),
            }),
          )
          .describe('empty when the conversation taught nothing durable about anyone'),
        unlisted: z
          .array(
            z.object({
              name: z.string().describe("the person's name alone — no role, org, or qualifier in parentheses"),
              kind: z
                .enum(['person', 'organization', 'product', 'other'])
                .describe(
                  'person only for a human being; a company, team, product, protocol, project, or place is not a person and is dropped',
                ),
              gist: z.string().describe('one line of what the conversation established about them'),
            }),
          )
          .describe('people materially discussed who have no profile listed'),
      }),
      prompt: [
        personFactsPrompt({ kind, userLabel: input.userLabel, today: input.today, profiles }),
        '',
        '<transcript>',
        input.transcript,
        '</transcript>',
      ].join('\n'),
    })
    // The kind field is the structural guard behind the prompt's "people
    // only": the model classifies every entry, and only people survive.
    return {
      facts: object.people,
      unlisted: object.unlisted.filter((u) => u.kind === 'person').map(({ name, gist }) => ({ name, gist })),
    }
  } catch (err) {
    // Abstain, but never silently: a chronically failing distiller must be
    // distinguishable from "nothing worth learning" in ai-errors.jsonl.
    await logAIError({ source: 'ai:chat', stage: 'people:distill', message: (err as Error).message })
    return undefined
  }
}
