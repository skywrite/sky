/**
 * The consolidation policy — the "prunes and maintains" half of the memory
 * store, as a pure plan over the loaded entries. Deliberately deterministic:
 * expiry, promotion, and budget enforcement are policy over frontmatter and
 * usage counts, inspectable line by line, with the one AI step (duplicate
 * merging) living outside this module. The plan speaks the same MemoryOp
 * vocabulary the distiller does, so applyMemoryOps enforces the identical
 * guards (locked files, missing targets) for both writers.
 *
 * Kind half-lives: threads are open loops and expire in days; observations
 * are staged captures — repeatedly confirmed ones get PROPOSED for the
 * notebook (never auto-written), unconfirmed stale ones die; the durable
 * kinds (preference, glossary, lesson) persist until both stale and
 * unshipped. Expiry is plain deletion — notebook git is the archive.
 */

import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { MemoryEntry } from './mod.ts'
import type { MemoryUsage } from './usage.ts'
import type { MemoryOp } from './write.ts'

export const CONSOLIDATE_POLICY = {
  /** Threads older than this expire — an open loop either closed or went stale. */
  threadMaxAgeDays: 14,
  /** Unpromoted observations older than this expire. */
  observationMaxAgeDays: 45,
  /** Confirmations at which an observation is proposed for real notebook capture. */
  observationPromoteUses: 3,
  /** Durable kinds (preference/glossary/lesson) expire only past this AND unshipped. */
  durableMaxAgeDays: 180,
  /**
   * Hard ceiling on the whole store. Memory must stay a note card, not a
   * second notebook — over the cap, the weakest survivors expire first.
   */
  storeMaxTokens: 15_000,
  /** Estimated frontmatter overhead per file, on top of summary + body. */
  fileOverheadTokens: 30,
} as const

export interface ConsolidationPlan {
  ops: MemoryOp[]
  /** Spared-for-a-reason lines the host reports (locked, undated, no telemetry) */
  notes: string[]
  /** Estimated store size before the plan applies */
  storeTokens: number
}

export interface PlanInput {
  entries: MemoryEntry[]
  /** Per-slug ship counts from gatherMemoryUsage */
  usage: ReadonlyMap<string, MemoryUsage>
  /**
   * False when no chat logs were scanned — "never shipped" is then unknown,
   * and the durable-kind expiry (which keys on it) is skipped entirely.
   */
  usageAvailable: boolean
  today: PlainDate
}

function entryTokens(m: MemoryEntry): number {
  return estimateTokens(m.body) + estimateTokens(m.summary) + CONSOLIDATE_POLICY.fileOverheadTokens
}

/** True when the entry's freshness is strictly before today − maxAgeDays. */
function olderThan(m: MemoryEntry, today: PlainDate, maxAgeDays: number): boolean {
  if (!m.freshness) return false
  try {
    return PlainDate.compare(PlainDate.from(m.freshness), today.addDays(-maxAgeDays)) < 0
  } catch {
    return false
  }
}

export function planConsolidation(input: PlanInput): ConsolidationPlan {
  const { entries, usage, usageAvailable, today } = input
  const ops: MemoryOp[] = []
  const notes: string[] = []
  const expired = new Set<string>()

  const expire = (m: MemoryEntry, reason: string) => {
    ops.push({ op: 'delete', slug: m.slug, reason })
    expired.add(m.slug)
  }

  for (const m of entries) {
    if (m.locked) continue // immortal by decree; noted only under budget pressure
    if (!m.kind) {
      notes.push(`${m.slug}: unknown kind — left alone`)
      continue
    }
    if (!m.freshness) {
      notes.push(`${m.slug}: no dates — expiry cannot age it`)
      continue
    }

    switch (m.kind) {
      case 'thread':
        if (olderThan(m, today, CONSOLIDATE_POLICY.threadMaxAgeDays)) {
          expire(m, `expired thread (stale since ${m.freshness})`)
        }
        break
      case 'observation':
        if (m.uses >= CONSOLIDATE_POLICY.observationPromoteUses) {
          // Confirmed enough to graduate: surfaced for a real capture flow,
          // never auto-written — the file stays until captured or deleted.
          ops.push({ op: 'propose', flow: 'notebook capture', gist: m.summary })
        } else if (olderThan(m, today, CONSOLIDATE_POLICY.observationMaxAgeDays)) {
          expire(m, `stale observation, never promoted (since ${m.freshness})`)
        }
        break
      default:
        // preference / glossary / lesson — durable until stale AND unshipped.
        if (
          usageAvailable &&
          olderThan(m, today, CONSOLIDATE_POLICY.durableMaxAgeDays) &&
          (usage.get(m.slug)?.ships ?? 0) === 0
        ) {
          expire(m, `stale and unshipped (since ${m.freshness})`)
        }
        break
    }
  }

  // Budget enforcement over the survivors: weakest first — fewest ships,
  // then fewest confirmations, then oldest; slug breaks ties so the plan is
  // reproducible. Locked files count toward the total but never expire.
  const storeTokens = entries.reduce((sum, m) => sum + entryTokens(m), 0)
  let survivorsTokens = entries.filter((m) => !expired.has(m.slug)).reduce((sum, m) => sum + entryTokens(m), 0)
  if (survivorsTokens > CONSOLIDATE_POLICY.storeMaxTokens) {
    const candidates = entries
      .filter((m) => !expired.has(m.slug) && !m.locked)
      .sort((a, b) => {
        const ships = (usage.get(a.slug)?.ships ?? 0) - (usage.get(b.slug)?.ships ?? 0)
        if (ships !== 0) return ships
        if (a.uses !== b.uses) return a.uses - b.uses
        const fresh = (a.freshness ?? '') < (b.freshness ?? '') ? -1 : (a.freshness ?? '') > (b.freshness ?? '') ? 1 : 0
        if (fresh !== 0) return fresh
        return a.slug < b.slug ? -1 : 1
      })
    for (const m of candidates) {
      if (survivorsTokens <= CONSOLIDATE_POLICY.storeMaxTokens) break
      expire(m, `over store budget (~${survivorsTokens} tokens > ${CONSOLIDATE_POLICY.storeMaxTokens})`)
      survivorsTokens -= entryTokens(m)
    }
    if (survivorsTokens > CONSOLIDATE_POLICY.storeMaxTokens) {
      notes.push(`store still ~${survivorsTokens} tokens over budget — the rest is locked`)
    }
  }

  return { ops, notes, storeTokens }
}
