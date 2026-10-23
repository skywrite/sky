import type { RecapCuration } from '#lib/notebook/recap/readRecapCuration.ts'
import { autoRelMessage, mergeRel } from './autoRel.ts'
import { autoTagMessage } from './autoTag.ts'

// Recaps classify against the recap archives only: the app is a recap's
// conversation, so each app's past tags and refs are the prior.
const RECAP_MEDIUMS = ['recap']

export type { RecapCuration }

export type EnrichRecapOptions = {
  /** A whole-day recap reads every section and has no tag or relationship count limit. */
  comprehensive?: boolean
  noAutoTag?: boolean
  noAutoRel?: boolean
  /** Receives one line per filled slot. */
  log?: (line: string) => void
}

function hasRel(rel: RecapCuration['rel']): boolean {
  return Array.isArray(rel) ? rel.length > 0 : Boolean(rel)
}

/**
 * Ordinary captures fill absence. Comprehensive recaps can add new subjects
 * on regeneration while retaining every curated tag and relationship.
 */
export function openSlots(curated: RecapCuration, opts: EnrichRecapOptions): { tags: boolean; rel: boolean } {
  return {
    tags: !opts.noAutoTag && (Boolean(opts.comprehensive) || !curated.tags),
    rel: !opts.noAutoRel && (Boolean(opts.comprehensive) || !hasRel(curated.rel)),
  }
}

/**
 * Fill a recap's empty tags/rel slots from the recap archives: tags from the
 * closed menu of tags already on recaps, refs from the entity graph guided
 * by this app's earlier recaps. Both run at once. Never throws; a slot the
 * classifiers abstain on stays empty, as it would have.
 */
export default async function enrichRecap(
  recap: {
    app: string
    what: string
    body: string
    /** What is being labeled, in the model's words: "daily GitHub activity recap". */
    kind: string
  },
  curated: RecapCuration,
  opts: EnrichRecapOptions = {},
  services = { tag: autoTagMessage, rel: autoRelMessage },
): Promise<RecapCuration> {
  const slots = openSlots(curated, opts)
  if (!slots.tags && !slots.rel) return curated

  const input = { to: recap.app, summary: recap.what, body: recap.body }
  const enrich = { mediums: RECAP_MEDIUMS, kind: recap.kind, comprehensive: opts.comprehensive }
  const [tags, rel] = await Promise.all([
    slots.tags ? services.tag(input, enrich) : undefined,
    slots.rel ? services.rel(input, enrich) : undefined,
  ])
  if (tags) opts.log?.(`  Auto-tags: ${tags}`)
  if (rel) opts.log?.(`  Auto-rel: ${rel.join(', ')}`)

  const combinedTags =
    [
      ...new Set(
        [curated.tags, tags]
          .flatMap((value) => value?.split(';') ?? [])
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ].join('; ') || undefined
  const existingRel = Array.isArray(curated.rel) ? curated.rel : curated.rel ? [curated.rel] : undefined
  return {
    tags: slots.tags ? (opts.comprehensive ? combinedTags : tags) : curated.tags,
    rel: slots.rel ? (opts.comprehensive ? mergeRel(existingRel, rel) : rel) : curated.rel,
  }
}
