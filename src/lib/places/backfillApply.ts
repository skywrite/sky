import { lstat, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { placeRefInIndex, type EntityIndex } from '#lib/notebook/enrich/resolve.ts'
import { changeLinks } from '#shared/models/Markdown/Document/changeLinks.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import type { DocumentIO } from '#shared/models/Person/write.ts'
import { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import { placeSourceFingerprint } from './backfill.ts'
import { placeChoiceForRef, placeChoices } from './catalog.ts'
import { countryPlace, ensurePlaceRef } from './geography.ts'

const reference = z.string().refine((value) => normalizePlaceRef(value) === value, 'Use a canonical places/ reference.')
const relativeFile = z
  .string()
  .refine(
    (value) =>
      value.endsWith('.md') &&
      !path.isAbsolute(value) &&
      !/[\\\0]/.test(value) &&
      value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'Use a notebook-relative markdown path without traversal.',
  )
const country = z.object({
  ref: reference.refine((ref) => !!countryPlace(ref), 'Only country records can be created.'),
  name: z.string(),
})
const previewSchema = z
  .object({
    path: relativeFile,
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    add: z.array(reference),
    create: z.array(country),
    evidence: z.array(z.object({ ref: reference, quote: z.string() })).optional(),
    review: z.array(
      z.object({
        name: z.string(),
        context: z.array(z.string()),
        candidates: z.array(z.object({ ref: z.string(), name: z.string(), hint: z.string() })),
      }),
    ),
    error: z.string().optional(),
  })
  .refine(
    (row) => !!row.error || (!row.add.length && !row.create.length) || !!row.fingerprint,
    'Every proposed change needs its source fingerprint. Generate a new preview.',
  )

/** A report is also the reviewable input: remove rejected rows, additions or country creations before applying. */
export const placeBackfillReportSchema = z
  .object({
    format: z.literal('sky-place-backfill-v1'),
    notebook: z.string().refine(path.isAbsolute, 'The report must identify its notebook.'),
    created: z.string(),
    since: z.string(),
    sample: z.enum(['recent', 'spread']),
    records: z.number().int().nonnegative(),
    analyzed: z.number().int().nonnegative(),
    repair: z.object({
      create: z.array(country),
      unresolved: z.array(z.object({ ref: z.string(), uses: z.number(), reason: z.string() })),
    }),
    previews: z.array(previewSchema),
  })
  .refine(
    (report) => new Set(report.previews.map((row) => row.path)).size === report.previews.length,
    'A document can appear only once in a report.',
  )

export type PlaceBackfillReport = z.infer<typeof placeBackfillReportSchema>
export interface PlaceBackfillApplied {
  path: string
  status: 'applied' | 'unchanged' | 'skipped' | 'failed'
  added: string[]
  created: string[]
  reason?: string
}

/** Resolve missing descendants too, but never treat a dangling symlink as a new directory. */
async function destination(file: string): Promise<string> {
  try {
    await lstat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(file) === file) throw error
    return path.join(await destination(path.dirname(file)), path.basename(file))
  }
  return realpath(file)
}

async function insideNotebook(root: string, file: string): Promise<void> {
  const relative = path.relative(root, await destination(file))
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('The selected file is outside this notebook.')
}

/** Apply retained proposals without calling AI. Every source is checked again before its versioned save. */
export async function applyPlaceBackfill(
  input: unknown,
  options: { notebook: string; io: DocumentIO; index: EntityIndex },
): Promise<PlaceBackfillApplied[]> {
  const report = placeBackfillReportSchema.parse(input)
  const root = await realpath(options.notebook)
  if (root !== (await realpath(report.notebook))) throw new Error('This report belongs to a different notebook.')
  const { index, io } = options
  if (!index.places) throw new Error('The place index is unavailable.')
  const store = index.places.store
  const identity = (raw: string) => (placeRefInIndex(raw, index) ?? raw).toLowerCase()
  const results: PlaceBackfillApplied[] = []
  for (const row of report.previews) {
    const result: PlaceBackfillApplied = { path: row.path, status: 'unchanged', added: [], created: [] }
    results.push(result)
    if (row.error) {
      result.status = 'skipped'
      result.reason = 'The preview could not analyze this document.'
      continue
    }
    if (!row.add.length && !row.create.length) continue
    try {
      await insideNotebook(root, path.join(root, row.path))
      const snapshot = await io.read(row.path)
      if (!snapshot) {
        result.status = 'skipped'
        result.reason = 'The source document is no longer available.'
        continue
      }
      const content = changeLinks(snapshot.content, row.add, [], identity)
      const existing = [...Document.fromMarkdown(snapshot.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).rel]
      const referenced = new Set([...existing, ...row.add].map(identity))
      const create = row.create.filter((item) => referenced.has(identity(item.ref)))
      const missing = create.some((item) => !store.findByPlacePath(item.ref))
      if (content === snapshot.content && !missing) continue
      if (placeSourceFingerprint(snapshot.content) !== row.fingerprint) {
        result.status = 'skipped'
        result.reason = 'The source changed since preview. Generate a new preview.'
        continue
      }
      const choices = placeChoices(store)
      const targets = [...new Set([...row.add, ...create.map((item) => item.ref)])].map((ref) => {
        const choice = placeChoiceForRef(ref, choices)
        if (!choice) throw new Error(`No unique place record resolves ${ref}. Review this reference first.`)
        if (choice.needsCreation && !create.some((item) => item.ref === choice.ref))
          throw new Error(`The report does not include creating ${ref}. Generate a new preview.`)
        return choice
      })
      // Check every destination before materializing any of this document's countries.
      for (const target of targets) await insideNotebook(root, target.path)
      for (const target of targets) {
        const saved = await ensurePlaceRef(store, target.ref)
        if (saved.created) result.created.push(saved.ref)
        if (saved.ref !== target.ref || path.resolve(saved.filePath) !== path.resolve(target.path))
          throw new Error('A selected place changed identity during apply. Generate a new preview.')
      }
      if (content !== snapshot.content) {
        const saved = await io.save(row.path, content, snapshot.version)
        if (!saved.saved) {
          result.status = 'skipped'
          result.reason = 'The source changed during apply. Its newer contents were preserved.'
          continue
        }
        const prior = new Set(existing.map(identity))
        result.added = [...new Set(row.add)].filter((ref) => !prior.has(identity(ref)))
      }
      result.status = result.created.length || result.added.length ? 'applied' : 'unchanged'
    } catch (error) {
      result.status = 'failed'
      result.reason = error instanceof Error ? error.message : String(error)
    }
  }
  return results
}
