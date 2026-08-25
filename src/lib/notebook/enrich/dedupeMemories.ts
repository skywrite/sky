import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModel, type Role } from '#shared/ai/models.ts'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'

// The consolidator's one AI step: spotting near-duplicate memories that two
// sessions wrote independently (big-deck vs the-big-deck). Everything else in
// consolidation is deterministic policy; this asks only "which entries are
// the same fact" and hands back merges the caller turns into update+delete
// ops — application, locked guards, and reporting stay in models/Memory.

const AI_TIMEOUT_MS = 60_000

export interface MemoryMerge {
  /** Slug that survives, rewritten with the merged content */
  keep: string
  /** Slugs absorbed into keep and deleted */
  absorb: string[]
  summary: string
  body: string
}

const mergeSchema = z.object({
  merges: z
    .array(
      z.object({
        keep: z.string().describe('the slug that survives'),
        absorb: z.array(z.string()).min(1).describe('slugs that say the same thing and fold into keep'),
        summary: z.string().describe('one-line gist of the merged memory'),
        body: z.string().describe('the merged 1-3 sentence body, keeping the freshest facts'),
      }),
    )
    .describe('empty unless two entries are genuinely the same fact — usually empty'),
})

/**
 * Ask the model which memories duplicate each other. Returns undefined on
 * model failure (the consolidation proceeds without merges), and never
 * returns a merge naming a locked or unknown slug.
 */
export async function dedupeMemories(memories: MemoryEntry[], role: Role = 'fast'): Promise<MemoryMerge[] | undefined> {
  if (memories.length < 2) return []
  const index = memories
    .map(
      (m) =>
        `- ${m.slug} (${m.kind ?? 'untyped'}${m.locked ? ', locked' : ''}) — ${m.summary}\n  ${m.body.replace(/\s*\n\s*/g, ' ')}`,
    )
    .join('\n')

  try {
    const { object } = await generateObject({
      ...aiModel(role),
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      schema: mergeSchema,
      prompt: [
        'Below is the full index of a tiny AI memory store. Different sessions occasionally write the same fact under different slugs. Identify entries that are GENUINELY the same fact — same referent, same claim — and return merges. Distinct facts about the same topic are NOT duplicates. Never merge entries marked locked. Most stores have no duplicates: an empty list is the normal answer.',
        '',
        '<memory-index>',
        index,
        '</memory-index>',
      ].join('\n'),
    })

    const known = new Map(memories.map((m) => [m.slug, m]))
    const usable = (slug: string) => known.has(slug) && !known.get(slug)?.locked
    return object.merges.filter(
      (m) => usable(m.keep) && m.absorb.length > 0 && m.absorb.every((s) => usable(s) && s !== m.keep),
    )
  } catch {
    return undefined
  }
}
