/**
 * Memory Consolidate - the maintenance pass over ai/memory/.
 *
 * Deterministic policy (models/Memory/consolidate.ts) expires stale threads
 * and observations, retires durable memories that are both stale and
 * unshipped (usage mined from saved chats' context logs), proposes
 * well-confirmed observations for real notebook capture, and enforces the
 * store's token budget. One optional AI step merges near-duplicates. Every
 * op — applied and skipped alike — prints, and --dry-run shows the full
 * plan without touching a file.
 *
 * Built to become the first automations charter; until then it runs by hand.
 */

import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dedupeMemories } from '#lib/notebook/enrich/dedupeMemories.ts'
import { DIR_AI_MEMORY, DIR_TIME } from '#shared/config.ts'
import { CONSOLIDATE_POLICY, planConsolidation } from '#shared/models/Memory/consolidate.ts'
import { loadMemories } from '#shared/models/Memory/mod.ts'
import { gatherMemoryUsage } from '#shared/models/Memory/usage.ts'
import { applyMemoryOps, type MemoryOp } from '#shared/models/Memory/write.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  dryRun: Flag.bool('Show the full plan without touching any file', { short: 'n', default: false }),
  days: Flag.number('Context-log telemetry window in days', { short: 'd', default: () => 28 }),
  noAi: Flag.bool('Skip the AI duplicate-merge step', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { memories: number; planned: number; applied: number; skipped: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ai:memory:consolidate': { params: Params; result: Result }
  }
}

/** Verb per memory op, mirroring ai:chat's exit-summary lines. */
const VERBS: Record<string, string> = {
  create: 'remembered',
  confirm: 'reinforced',
  update: 'revised',
  delete: 'forgot',
  propose: 'proposed',
}

/** The consolidator batches beyond a chat save's cap — merges + expiry together. */
const CONSOLIDATE_MAX_OPS = 64

export default class MemoryConsolidateTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:memory:consolidate',
    description: 'Prune, merge, and budget the AI memory store (ai/memory/)',
    descriptionLong: [
      'The maintenance pass over the AI memory store:',
      '- expires stale threads and never-promoted observations',
      '- proposes well-confirmed observations for real notebook capture',
      '- retires durable memories that are stale AND unshipped (usage mined',
      "  from saved chats' context logs — zero extra instrumentation)",
      '- merges near-duplicates (the one AI step; skip with --no-ai)',
      `- enforces the ~${CONSOLIDATE_POLICY.storeMaxTokens}-token store budget, weakest first`,
      '',
      'locked: true memories are never touched. Deletion is plain removal —',
      'the notebook git history is the archive.',
    ],
    usage: [
      'sky ai:memory:consolidate --dry-run',
      'sky ai:memory:consolidate',
      'sky ai:memory:consolidate --days 56 --no-ai',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { dryRun, days, noAi } = args
    const today = PlainDate.from(context.notebookNow.date)

    const entries = await loadMemories(DIR_AI_MEMORY)
    if (entries.length === 0) {
      output.log('Memory store is empty — nothing to consolidate.')
      return CommandResult.success({ memories: 0, planned: 0, applied: 0, skipped: 0 })
    }

    const { usage, chatsScanned } = await gatherMemoryUsage({ timeDir: DIR_TIME, today, days })

    // The one AI step. An abstain (model failure) drops merging, never the run.
    const merges = noAi ? [] : ((await dedupeMemories(entries)) ?? [])
    const mergeOps: MemoryOp[] = merges.flatMap((m) => [
      { op: 'update' as const, slug: m.keep, summary: m.summary, body: m.body },
      ...m.absorb.map((slug) => ({ op: 'delete' as const, slug, reason: `merged into ${m.keep}` })),
    ])

    const plan = planConsolidation({ entries, usage, usageAvailable: chatsScanned > 0, today })
    const ops = [...mergeOps, ...plan.ops]

    output.log(
      colors.dim(
        `Store: ${entries.length} memories (~${plan.storeTokens} tokens, cap ${CONSOLIDATE_POLICY.storeMaxTokens}) — telemetry: ${chatsScanned} chats over ${days}d`,
      ),
    )
    for (const note of plan.notes) {
      output.log(colors.dim(`  ${note}`))
    }

    if (ops.length === 0) {
      output.log('Nothing to consolidate.')
      return CommandResult.success({ memories: entries.length, planned: 0, applied: 0, skipped: 0 })
    }

    if (dryRun) {
      output.log('')
      for (const op of ops) {
        const gist = op.op === 'propose' ? `${op.gist} → ${op.flow}` : op.op === 'create' ? op.summary : op.slug
        const why = op.op === 'delete' ? ` — ${op.reason}` : ''
        output.log(`🧠 would ${(VERBS[op.op] ?? op.op).padEnd(10)} ${gist}${why}`)
      }
      output.log('')
      output.log(colors.dim(`Dry run: ${ops.length} op${ops.length === 1 ? '' : 's'} planned, nothing applied.`))
      return CommandResult.success({ memories: entries.length, planned: ops.length, applied: 0, skipped: 0 })
    }

    const outcomes = await applyMemoryOps({
      memoryDir: DIR_AI_MEMORY,
      ops,
      today: today.toString(),
      source: `ai:memory:consolidate ${today}`,
      maxOps: CONSOLIDATE_MAX_OPS,
    })

    output.log('')
    for (const o of outcomes) {
      const line = `🧠 ${(VERBS[o.op] ?? o.op).padEnd(10)} ${o.summary}`
      output.log(o.outcome === 'skipped' ? colors.dim(`${line} — skipped: ${o.reason}`) : line)
    }

    const applied = outcomes.filter((o) => o.outcome === 'applied').length
    const skipped = outcomes.length - applied
    output.log('')
    output.log(colors.dim(`${applied} applied, ${skipped} skipped.`))
    return CommandResult.success({ memories: entries.length, planned: ops.length, applied, skipped })
  }
}
