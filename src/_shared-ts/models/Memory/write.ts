/**
 * The write half of the memory store: applying distiller ops to ai/memory/.
 *
 * The save-time distiller (lib/notebook/enrich/distillMemories.ts) reads the
 * finished conversation against the current memory index and returns ops;
 * this module is the only thing that turns them into files. The dir is the
 * one notebook space with a standing write license, so the discipline lives
 * here instead of an approval prompt: ops are capped per save and new files
 * capped tighter, `locked` memories are never rewritten or deleted, a
 * missing target is skipped rather than invented, and every op — applied or
 * skipped — returns an outcome the host renders (the 🧠 lines) and the
 * transcript's context log records. Deletion is plain removal: notebook git
 * is the archive.
 */

import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { missing, withProcessLock } from '#lib/jobs/files.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { MEMORY_KINDS, type MemoryKind, yamlDate } from './mod.ts'

// -----------------------------------------------------------------------------
// Ops — what a distillation may ask for
// -----------------------------------------------------------------------------

export type MemoryOp =
  /** A new memory (an existing slug is refined in place instead) */
  | { op: 'create'; kind: MemoryKind; slug: string; summary: string; body: string }
  /** The conversation re-taught or relied on this memory: bump lastConfirmed and uses */
  | { op: 'confirm'; slug: string }
  /** The conversation refined or corrected this memory: rewrite its content */
  | { op: 'update'; slug: string; summary?: string; body: string }
  /** The conversation invalidated this memory */
  | { op: 'delete'; slug: string; reason: string }
  /**
   * Notebook-worthy content: surfaced to the user, never written anywhere.
   * Only the consolidator emits this today (an observation confirmed often
   * enough to graduate). The distiller stopped proposing on 2026-08-29: a
   * proposal printed once at chat exit had no consumer — see docs/.
   */
  | { op: 'propose'; flow: string; gist: string }

/** One op's fate, for the host's 🧠 line and the transcript's context log. */
export interface MemoryOpOutcome {
  op: MemoryOp['op']
  slug?: string
  kind?: MemoryKind
  /** One-line human gist of what happened */
  summary: string
  outcome: 'applied' | 'skipped'
  /** Why a skipped op was skipped */
  reason?: string
  /** confirm only: the new distinct-session count */
  uses?: number
}

/**
 * Runaway backstop: a distillation asking for more than this many ops is a
 * model failure, not a rich conversation — the memory store must stay small
 * by design, and the excess is skipped visibly rather than applied.
 */
export const MAX_OPS_PER_SAVE = 8

/**
 * New files per save. The op cap bounds runaway output; this bounds the
 * store's growth, which the op cap never did — a rich chat asking for eight
 * creates was inside the cap and still wrong (docs/2026-08-29-distiller-
 * harvested-its-own-answers.md). Confirms, updates, and deletes are not
 * counted: they keep the store honest, not bigger. A create on an existing
 * slug is an update and is not counted either.
 */
export const MAX_CREATES_PER_SAVE = 3

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

const KEY_ORDER = ['created', 'updated', 'kind', 'summary', 'source', 'lastConfirmed', 'uses', 'locked']

interface MemoryFileFields {
  created: string
  updated: string
  kind?: MemoryKind
  summary: string
  source: string
  lastConfirmed: string
  uses: number
  locked?: boolean
  body: string
}

function memoryMarkdown(f: MemoryFileFields): string {
  const yaml: Record<string, unknown> = {
    created: f.created,
    updated: f.updated,
    ...(f.kind ? { kind: f.kind } : {}),
    summary: f.summary,
    source: f.source,
    lastConfirmed: f.lastConfirmed,
    uses: f.uses,
    ...(f.locked ? { locked: true } : {}),
  }
  return `---\n${stringify(yaml, { keyOrder: KEY_ORDER }).trimEnd()}\n---\n\n${f.body}\n`
}

/** Kebab-case a model-proposed slug; empty result means the op is unusable. */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

/** Hash the exact on-disk contents so corrections can detect intervening edits. */
export const memoryRevision = (content: string): string => createHash('sha256').update(content).digest('hex')

/** A body must be plain prose — leading frontmatter fences would corrupt the file. */
function cleanBody(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .trim()
    .replace(/^-{3,}\s*\n?/, '')
    .trim()
}

// -----------------------------------------------------------------------------
// Applying
// -----------------------------------------------------------------------------

interface ExistingMemory {
  revision: string
  created?: string
  updated?: string
  /** The teaching chat — survives confirms, moves on updates */
  source?: string
  uses: number
  kind?: MemoryKind
  locked: boolean
  summary: string
  body: string
}

async function readExisting(filePath: string): Promise<ExistingMemory | null> {
  const stat = await lstat(filePath).catch((error: unknown) => {
    if (missing(error)) return null
    throw error
  })
  if (!stat) return null
  if (!stat.isFile()) throw new Error('Memory must be a regular file, not a link or directory.')
  const content = await readTextFile(filePath)
  const doc = Document.fromMarkdown(content)
  const rawKind = String(doc.yaml['kind'] ?? '')
  const source = String(doc.yaml['source'] ?? '').trim()
  return {
    revision: memoryRevision(content),
    created: yamlDate(doc.yaml['created']),
    updated: yamlDate(doc.yaml['updated']),
    ...(source ? { source } : {}),
    uses: Number(doc.yaml['uses'] ?? 0) || 0,
    kind: (MEMORY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as MemoryKind) : undefined,
    locked: doc.yaml['locked'] === true,
    summary: String(doc.yaml['summary'] ?? '').trim(),
    body: doc.toMarkdown({ yaml: false }).trim(),
  }
}

export interface ApplyMemoryOpsInput {
  memoryDir: string
  ops: MemoryOp[]
  /** YYYY-MM-DD stamped into updated/lastConfirmed (and created on new files) */
  today: string
  /** Teaching chat's notebook path or host-owned live-chat reference, recorded as source: */
  source: string
  /** Explicit edits use the revision they read; null reserves a new memory without replacing one. */
  expectedRevisions?: Record<string, string | null>
  signal?: AbortSignal
  /** Op ceiling override — the consolidator legitimately batches more than a save's cap */
  maxOps?: number
  /** New-file ceiling override; the consolidator never creates, so it leaves this alone */
  maxCreates?: number
}

/** Per-save allowances applyOne draws down as it writes. */
interface ApplyBudget {
  /** New files still allowed this save */
  creates: number
}

/**
 * Apply ops sequentially against the store. Never throws: an op that cannot
 * apply — locked target, missing target, invalid slug, IO failure, over the
 * per-save cap — returns a skipped outcome instead, so one bad op never
 * costs the rest or the save itself.
 */
export async function applyMemoryOps(input: ApplyMemoryOpsInput): Promise<MemoryOpOutcome[]> {
  try {
    // All writers share a local lock, outside the synced notebook.
    const key = createHash('sha256').update(path.resolve(input.memoryDir)).digest('hex')
    const lock = path.join(tmpdir(), 'sky-memory-writes', key)
    return await withProcessLock(lock, () => applyUnlockedMemoryOps(input))
  } catch (error) {
    return input.ops.map((op) => ({
      op: op.op,
      summary: opGist(op),
      outcome: 'skipped',
      reason: error instanceof Error ? error.message : String(error),
    }))
  }
}

async function applyUnlockedMemoryOps(input: ApplyMemoryOpsInput): Promise<MemoryOpOutcome[]> {
  const outcomes: MemoryOpOutcome[] = []
  const cap = input.maxOps ?? MAX_OPS_PER_SAVE
  const budget: ApplyBudget = { creates: input.maxCreates ?? MAX_CREATES_PER_SAVE }
  for (const [i, op] of input.ops.entries()) {
    if (i >= cap) {
      outcomes.push({ op: op.op, summary: opGist(op), outcome: 'skipped', reason: 'per-save op cap' })
      continue
    }
    try {
      input.signal?.throwIfAborted()
      outcomes.push(await applyOne(op, input, budget))
    } catch (err) {
      outcomes.push({ op: op.op, summary: opGist(op), outcome: 'skipped', reason: (err as Error).message })
    }
  }
  return outcomes
}

/** Best short description of an op, for outcomes that never reached a file. */
function opGist(op: MemoryOp): string {
  if (op.op === 'propose') return op.gist
  if (op.op === 'create') return op.summary
  return op.slug
}

async function applyOne(op: MemoryOp, input: ApplyMemoryOpsInput, budget: ApplyBudget): Promise<MemoryOpOutcome> {
  // Proposals are surfaced, never written — capture flows own the notebook.
  if (op.op === 'propose') {
    return { op: 'propose', summary: `${op.gist} → ${op.flow}`, outcome: 'applied' }
  }

  const slug = sanitizeSlug(op.slug)
  if (!slug) return { op: op.op, summary: opGist(op), outcome: 'skipped', reason: 'invalid slug' }
  const filePath = path.join(input.memoryDir, `${slug}.md`)
  const existing = await readExisting(filePath)

  const expected = input.expectedRevisions?.[slug]
  if (expected !== undefined && expected !== (existing?.revision ?? null)) {
    return {
      op: op.op,
      slug,
      summary: existing?.summary || opGist(op),
      outcome: 'skipped',
      reason: 'Memory changed since it was read. Search memories again before updating it.',
    }
  }

  if (existing?.locked) {
    return { op: op.op, slug, summary: existing.summary || slug, outcome: 'skipped', reason: 'locked' }
  }

  switch (op.op) {
    case 'create': {
      const body = cleanBody(op.body)
      if (!body) return { op: 'create', slug, summary: op.summary, outcome: 'skipped', reason: 'empty body' }
      // Only a create that adds a file draws on the allowance — an existing
      // slug is an update in truth and is never capped as growth.
      if (!existing) {
        if (budget.creates <= 0) {
          return {
            op: 'create',
            slug,
            kind: op.kind,
            summary: op.summary,
            outcome: 'skipped',
            reason: 'per-save create cap',
          }
        }
        budget.creates -= 1
      }
      // An existing slug is refined in place — created and uses survive, and
      // the outcome says 'update' so the host's verb stays truthful.
      await writeMemory(
        filePath,
        memoryMarkdown({
          created: existing?.created ?? input.today,
          updated: input.today,
          kind: op.kind,
          summary: op.summary,
          source: input.source,
          lastConfirmed: input.today,
          uses: existing?.uses ?? 0,
          body,
        }),
        !existing,
      )
      return { op: existing ? 'update' : 'create', slug, kind: op.kind, summary: op.summary, outcome: 'applied' }
    }
    case 'confirm': {
      if (!existing) return { op: 'confirm', slug, summary: slug, outcome: 'skipped', reason: 'no such memory' }
      const uses = existing.uses + 1
      // Content is untouched: updated stays put, only lastConfirmed/uses move.
      // The source stays too — a confirm is evidence the memory holds, not a
      // re-teaching; only an update moves provenance to the correcting chat.
      await writeMemory(
        filePath,
        memoryMarkdown({
          created: existing.created ?? input.today,
          updated: existing.updated ?? input.today,
          kind: existing.kind,
          summary: existing.summary || slug,
          source: existing.source ?? input.source,
          lastConfirmed: input.today,
          uses,
          body: existing.body,
        }),
      )
      return { op: 'confirm', slug, kind: existing.kind, summary: existing.summary || slug, outcome: 'applied', uses }
    }
    case 'update': {
      if (!existing) return { op: 'update', slug, summary: slug, outcome: 'skipped', reason: 'no such memory' }
      const body = cleanBody(op.body)
      if (!body)
        return { op: 'update', slug, summary: existing.summary || slug, outcome: 'skipped', reason: 'empty body' }
      const summary = op.summary?.trim() || existing.summary || slug
      // source moves to the correcting chat: an update IS a re-teaching.
      await writeMemory(
        filePath,
        memoryMarkdown({
          created: existing.created ?? input.today,
          updated: input.today,
          kind: existing.kind,
          summary,
          source: input.source,
          lastConfirmed: input.today,
          uses: existing.uses,
          body,
        }),
      )
      return { op: 'update', slug, kind: existing.kind, summary, outcome: 'applied' }
    }
    case 'delete': {
      if (!existing) return { op: 'delete', slug, summary: slug, outcome: 'skipped', reason: 'no such memory' }
      await unlink(filePath)
      return {
        op: 'delete',
        slug,
        kind: existing.kind,
        summary: `${existing.summary || slug} — ${op.reason}`,
        outcome: 'applied',
      }
    }
  }
}

/** Publish a complete file; a concurrent namesake must never be overwritten on create. */
async function writeMemory(file: string, content: string, create = false): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    if (create) await link(temporary, file)
    else await rename(temporary, file)
  } finally {
    await handle.close()
    await unlink(temporary).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}
