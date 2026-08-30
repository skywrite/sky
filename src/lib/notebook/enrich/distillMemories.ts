import { generateObject } from 'ai'
import { z } from 'zod'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel, type Role } from '#shared/ai/models.ts'
import { MEMORY_KINDS, type MemoryEntry } from '#shared/models/Memory/mod.ts'
import { MAX_CREATES_PER_SAVE, type MemoryOp } from '#shared/models/Memory/write.ts'

// The save-time memory distiller: reads the finished conversation against the
// current ai/memory/ index and decides what the store should learn. The
// calibration lives in the prompt's bar — most conversations teach NOTHING,
// memory holds only what the USER taught (never what the assistant
// concluded), and only what no notebook document would hold. Applying the
// ops, the per-save caps, and the locked-file guard all live in
// models/Memory/write.ts; this module only asks the model.
//
// The bar is spelled out at this length on purpose. The first live week ran
// a one-line bar on the fast model and the store filled with the assistant's
// own conclusions, report figures, and assessments of people — see
// models/Memory/docs/2026-08-29-distiller-harvested-its-own-answers.md.

// generateObject has no timeout option; an unbounded call can hang forever.
const AI_TIMEOUT_MS = 60_000

// No `propose` op here: a proposal printed once at chat exit had no consumer.
// Decisions and ideas made in a chat are captured in the chat (the creation
// tools) or not at all; the distiller's job is only what the store learns.
const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    kind: z.enum(MEMORY_KINDS),
    slug: z.string().describe('short-kebab-case handle, stable and descriptive'),
    summary: z.string().describe('one-line gist'),
    body: z.string().describe('1-3 short self-contained sentences'),
  }),
  z.object({ op: z.literal('confirm'), slug: z.string() }),
  z.object({
    op: z.literal('update'),
    slug: z.string(),
    summary: z.string().optional(),
    body: z.string().describe('the corrected 1-3 sentence body'),
  }),
  z.object({ op: z.literal('delete'), slug: z.string(), reason: z.string() }),
])

export type DistillInput = {
  /** The packed conversation transcript */
  transcript: string
  /** The store's current entries — the model confirms/updates against these */
  memories: MemoryEntry[]
  /** What is being distilled, in the model's words — e.g. 'AI chat conversation' */
  kind?: string
}

function indexLine(m: MemoryEntry): string {
  const marks = [m.kind ?? 'untyped', ...(m.locked ? ['locked'] : [])].join(', ')
  return `- ${m.slug} (${marks}) — ${m.summary}`
}

/**
 * Ask the model what the memory store should learn from this conversation.
 * Returns undefined on model error — the save proceeds without memory ops,
 * mirroring the other enrichers' abstain behavior.
 *
 * The role defaults to `balanced`, not `fast`: telling what the user taught
 * apart from what the assistant said is a judgment call the fast model did
 * not hold in its first live week.
 */
export async function distillMemories(input: DistillInput, role: Role = 'balanced'): Promise<MemoryOp[] | undefined> {
  if (!input.transcript.trim()) return undefined
  const kind = input.kind ?? 'conversation'
  const index = input.memories.length > 0 ? input.memories.map(indexLine).join('\n') : '(the store is empty)'

  try {
    const { object } = await generateObject({
      ...aiModel(role),
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      schema: z.object({
        ops: z.array(opSchema).describe('empty when the conversation taught nothing durable'),
      }),
      prompt: [
        `You maintain a tiny cross-session memory store for a personal AI assistant. Below are a finished ${kind} and the store's current index. Decide what the store should learn from this conversation and return the operations.`,
        '',
        "WHOSE WORDS COUNT — the user's only:",
        '- Memory holds what the USER taught, corrected, asked to remember, or visibly relied on. Read the User turns for it.',
        "- The AI turns are context for reading the user, never a source. The assistant's analysis, conclusions, recommendations, framings, and summaries are already saved with the conversation. Quoting them back as memory is the failure this store exists to avoid.",
        '',
        'THE BAR — most conversations teach nothing:',
        '- Return ZERO ops unless something will clearly change how a FUTURE conversation should be answered.',
        `- At most ${MAX_CREATES_PER_SAVE} creates per conversation, however rich it was. Confirms are free.`,
        '- One memory = one durable fact. Bodies are 1-3 short self-contained sentences that still make sense months later: no "tonight", "this week", or "the report above".',
        '- Write about the user in the third person ("the user"); never "you" or "I".',
        '',
        'NEVER memory — return nothing for these, and never file them as observations:',
        '- Figures and data from a document the user was discussing: report metrics, deal terms, treasury positions, prices, compensation numbers. The document holds them; a memory copy goes stale first.',
        "- The conversation's own analysis or takeaways: a strategy read, a market insight, a design pattern, a framing that landed. That is the answer, and the saved chat keeps it.",
        '- Assessments of other people: strengths, failure modes, how to handle someone. Person facts are distilled separately into their profiles.',
        "- Designs, plans, decisions, or ideas worked out in one conversation. The notebook's capture flows own those.",
        '- Events, meetings, tasks, and anything else the notebook records.',
        '',
        'Kinds — each has exactly one meaning:',
        '- preference: how the user wants answers or behavior — format, tone, what to lead with, what never to do.',
        "- glossary: what the user's shorthand, abbreviation, or nickname means.",
        '- thread: an informal open loop the user is carrying that no task or document tracks; it expires on its own.',
        "- observation: a stable fact about the user's own life or setup that no notebook document records — tools they use, where their records live, a standing constraint.",
        '- lesson: what answering or retrieval strategy worked or failed for this user — where to look first, what to verify, what to distrust.',
        '',
        'Rules:',
        '- If the user explicitly asked to remember something ("remember this", "don\'t forget", or a correction like "no - X means Y"), that MUST become a create or update, capturing their meaning faithfully.',
        '- If the conversation contradicts an existing memory, update it (refined) or delete it (invalidated).',
        '- If the user re-taught or clearly relied on an existing memory, confirm it.',
        '- Never create a near-duplicate of an existing memory — confirm or update the existing slug instead.',
        '- Never touch entries marked locked.',
        '',
        'Calibration examples (synthetic):',
        '- User: "stop writing PnL, write it out" → create preference: write "profit and loss" in full; the user rejected the abbreviation.',
        '- User: "remember I lift on Tuesdays and Fridays" → create observation, keeping their meaning verbatim.',
        '- User: "those were the June figures, always check the latest post first" → create lesson: verify positions against the latest post before citing them.',
        '- The assistant concluded "the Atlas deal margin is ~40%, not break-even" → nothing: analysis, and the deal document holds the numbers.',
        '- The assistant wrote "Jane Doe is the strongest operator on the team" → nothing: a person fact, owned by her profile.',
        '- The assistant proposed an eight-step integration design → nothing: a design, owned by a capture flow.',
        '- A long conversation in which the user only asked questions → nothing.',
        '',
        '<memory-index>',
        index,
        '</memory-index>',
        '',
        '<transcript>',
        input.transcript,
        '</transcript>',
      ].join('\n'),
    })
    return object.ops
  } catch (err) {
    // Abstain, but never silently: a chronically failing distiller must be
    // distinguishable from "nothing worth remembering" in ai-errors.jsonl.
    await logAIError({ source: 'ai:chat', stage: 'memory:distill', message: (err as Error).message })
    return undefined
  }
}
