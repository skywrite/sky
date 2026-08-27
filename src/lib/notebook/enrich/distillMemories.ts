import { generateObject } from 'ai'
import { z } from 'zod'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModel, type Role } from '#shared/ai/models.ts'
import { MEMORY_KINDS, type MemoryEntry } from '#shared/models/Memory/mod.ts'
import type { MemoryOp } from '#shared/models/Memory/write.ts'

// The save-time memory distiller: reads the finished conversation against the
// current ai/memory/ index and decides what the store should learn. The
// calibration lives in the prompt's bar — most conversations teach NOTHING,
// and memory only holds what no notebook capture flow (decisions, ideas,
// notes) would take. Applying the ops, the per-save cap, and the locked-file
// guard all live in models/Memory/write.ts; this module only asks the model.

// generateObject has no timeout option; an unbounded call can hang forever.
const AI_TIMEOUT_MS = 60_000

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
  z.object({
    op: z.literal('propose'),
    flow: z.string().describe("the capture flow this belongs in, e.g. 'decision', 'idea', 'note'"),
    gist: z.string().describe('one line of what should be captured'),
  }),
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
 */
export async function distillMemories(input: DistillInput, role: Role = 'fast'): Promise<MemoryOp[] | undefined> {
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
        'THE BAR — most conversations teach nothing:',
        '- Return ZERO ops unless something will clearly change how a FUTURE conversation should be answered.',
        "- Never store what the user's notebook already records (events, meetings, tasks, documents, data). Memory holds only how-to-serve knowledge no notebook document would: answer preferences, what the user's shorthand means, informal open loops, uncaptured stable facts, retrieval lessons.",
        '- One memory = one durable fact. Bodies are 1-3 short self-contained sentences.',
        '',
        'Kinds: preference (how to answer or behave) / glossary (what shorthand or a nickname means) / thread (an informal open loop that expires naturally) / observation (a stable personal fact, staged for possible notebook capture) / lesson (what answering or retrieval strategy works for this user).',
        '',
        'Rules:',
        '- If the user explicitly asked to remember something ("remember this", "don\'t forget", or a correction like "no - X means Y"), that MUST become a create or update, capturing their meaning faithfully.',
        '- If the conversation contradicts an existing memory, update it (refined) or delete it (invalidated).',
        '- If the user re-taught or clearly relied on an existing memory, confirm it.',
        '- Never create a near-duplicate of an existing memory — confirm or update the existing slug instead.',
        '- Never touch entries marked locked.',
        '- If something belongs in the notebook itself (a decision that was made, a real idea, a durable fact for an org file), return propose with the flow and a one-line gist — and do NOT also create a memory for it. Person-profile facts are distilled separately at save — never propose or store those.',
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
