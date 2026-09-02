import type { RecapCuration } from '#lib/notebook/recap/readRecapCuration.ts'
import { autoRelMessage } from './autoRel.ts'
import { autoTagMessage } from './autoTag.ts'

// Recaps classify against the recap archives only: the app is a recap's
// conversation, so each app's past tags and refs are the prior.
const RECAP_MEDIUMS = ['recap']

export type { RecapCuration }

export type EnrichRecapOptions = {
  noAutoTag?: boolean
  noAutoRel?: boolean
  /** Receives one line per filled slot. */
  log?: (line: string) => void
}

function hasRel(rel: RecapCuration['rel']): boolean {
  return Array.isArray(rel) ? rel.length > 0 : Boolean(rel)
}

/**
 * Which slots enrichment may fill: the empty ones, unless a flag closes
 * them. A hand-curated value or a --rel argument always wins; enrichment
 * only ever fills absence, matching every other capture.
 */
export function openSlots(curated: RecapCuration, opts: EnrichRecapOptions): { tags: boolean; rel: boolean } {
  return {
    tags: !opts.noAutoTag && !curated.tags,
    rel: !opts.noAutoRel && !hasRel(curated.rel),
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
): Promise<RecapCuration> {
  const slots = openSlots(curated, opts)
  if (!slots.tags && !slots.rel) return curated

  const input = { to: recap.app, summary: recap.what, body: recap.body }
  const enrich = { mediums: RECAP_MEDIUMS, kind: recap.kind }
  const [tags, rel] = await Promise.all([
    slots.tags ? autoTagMessage(input, enrich) : undefined,
    slots.rel ? autoRelMessage(input, enrich) : undefined,
  ])
  if (tags) opts.log?.(`  Auto-tags: ${tags}`)
  if (rel) opts.log?.(`  Auto-rel: ${rel.join(', ')}`)

  return {
    tags: slots.tags ? tags : curated.tags,
    rel: slots.rel ? rel : curated.rel,
  }
}
