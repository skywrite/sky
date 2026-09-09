import { autoRelServices, proposeRel, type AutoRelServices } from '#lib/notebook/enrich/autoRel.ts'
import type { MessageRecord } from '#lib/notebook/enrich/corpus.ts'
import { placeRefInIndex } from '#lib/notebook/enrich/resolve.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { placeChoiceForRef, type PlaceMatch } from './catalog.ts'

export interface PlaceBackfillPreview {
  path: string
  add: string[]
  create: Array<{ ref: string; name: string }>
  review: Array<{ name: string; context: string[]; candidates: Array<{ ref: string; name: string; hint: string }> }>
  error?: string
}

/** Preview only: neither the source nor an unsaved country is written. */
export async function previewPlaceBackfill(
  record: MessageRecord,
  services: AutoRelServices = autoRelServices,
): Promise<PlaceBackfillPreview> {
  const index = await services.buildIndex()
  const choices = index.places?.choices ?? []
  const document = Document.fromMarkdown(record.body).stripHtmlComments()
  const proposal = await proposeRel(
    { body: document.markdown, summary: record.summary, to: record.to, from: record.from },
    { mediums: [record.medium], kind: record.medium, placesOnly: true },
    { ...services, buildIndex: async () => index },
  )
  const identity = (raw: string) => (placeRefInIndex(raw, index) ?? raw).toLowerCase()
  const existing = new Set(record.rel.map(identity))
  const add = proposal.rel.filter((ref) => !existing.has(identity(ref)))
  const create = new Map<string, { ref: string; name: string }>()
  for (const ref of [...record.rel, ...add]) {
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
    add,
    create: [...create.values()],
    review: proposal.unresolvedPlaces.map(review),
    ...(proposal.error ? { error: proposal.error } : {}),
  }
}
