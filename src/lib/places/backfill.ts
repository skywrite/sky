import { createHash } from 'node:crypto'
import { autoRelServices, proposeRel, type AutoRelServices } from '#lib/notebook/enrich/autoRel.ts'
import type { MessageRecord } from '#lib/notebook/enrich/corpus.ts'
import { placeRefInIndex } from '#lib/notebook/enrich/resolve.ts'
import { changeLinks } from '#shared/models/Markdown/Document/changeLinks.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { placeChoiceForRef, type PlaceMatch } from './catalog.ts'

export interface PlaceBackfillPreview {
  path: string
  fingerprint?: string
  add: string[]
  create: Array<{ ref: string; name: string }>
  evidence?: Array<{ ref: string; quote: string }>
  review: Array<{ name: string; context: string[]; candidates: Array<{ ref: string; name: string; hint: string }> }>
  error?: string
}

/** Preview only: neither the source nor an unsaved country is written. */
export async function previewPlaceBackfill(
  record: MessageRecord,
  services: AutoRelServices = autoRelServices,
): Promise<PlaceBackfillPreview> {
  // Validate rel/YAML even when the model would abstain; never plan against a lossy parse.
  changeLinks(record.body, [], [])
  const index = await services.buildIndex()
  const choices = index.places?.choices ?? []
  const original = Document.fromMarkdown(record.body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  const document = original.stripHtmlComments()
  const proposal = await proposeRel(
    {
      body: document.markdown,
      summary: typeof original.yaml['summary'] === 'string' ? original.yaml['summary'] : undefined,
      to: record.to,
      from: record.from,
    },
    { mediums: [record.medium], kind: record.medium, placesOnly: true },
    { ...services, buildIndex: async () => index },
  )
  const identity = (raw: string) => (placeRefInIndex(raw, index) ?? raw).toLowerCase()
  const currentRel = [...original.rel]
  const existing = new Set(currentRel.map(identity))
  const add = proposal.rel.filter((ref) => !existing.has(identity(ref)))
  const create = new Map<string, { ref: string; name: string }>()
  for (const ref of [...currentRel, ...add]) {
    const choice = placeChoiceForRef(ref, choices)
    if (choice?.needsCreation) create.set(choice.ref, { ref: choice.ref, name: choice.name })
  }
  const review = (match: PlaceMatch): PlaceBackfillPreview['review'][number] => ({
    name: match.mention.name,
    context: match.mention.context ?? [],
    candidates: match.candidates.map(({ ref, name, hint }) => ({ ref, name, hint })),
  })
  return {
    path: record.path,
    fingerprint: placeSourceFingerprint(record.body),
    add,
    create: [...create.values()],
    evidence: proposal.placeEvidence?.filter((item) => add.includes(item.ref)) ?? [],
    review: proposal.unresolvedPlaces.map(review),
    ...(proposal.error ? { error: proposal.error } : {}),
  }
}

/** Hash the exact source bytes, including metadata and comments, before any model work. */
export function placeSourceFingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A spread sample balances media and spans each medium's date range deterministically. */
export function samplePlaceRecords(
  records: MessageRecord[],
  limit: number,
  sample: 'recent' | 'spread',
): MessageRecord[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Provide a nonnegative integer --limit.')
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path))
  if (sample === 'recent') return sorted.reverse().slice(0, limit)
  const groups = new Map<string, MessageRecord[]>()
  for (const record of sorted) {
    const group = groups.get(record.medium) ?? []
    group.push(record)
    groups.set(record.medium, group)
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows)
  const counts = buckets.map(() => 0)
  let remaining = Math.min(limit, sorted.length)
  while (remaining > 0) {
    for (let i = 0; i < buckets.length && remaining > 0; i++) {
      if (counts[i]! < buckets[i]!.length) {
        counts[i]!++
        remaining--
      }
    }
  }
  return buckets
    .flatMap((rows, i) =>
      Array.from(
        { length: counts[i]! },
        (_, j) => rows[counts[i] === 1 ? rows.length - 1 : Math.round((j * (rows.length - 1)) / (counts[i]! - 1))]!,
      ),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path))
}
