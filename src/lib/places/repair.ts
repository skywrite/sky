import type Document from '#shared/models/Markdown/Document/mod.ts'
import { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { countryPlace } from './geography.ts'

export interface PlaceRepairPlan {
  create: Array<{ ref: string; name: string }>
  unresolved: Array<{ ref: string; uses: number; reason: string }>
}

/** Inspect explicit references only. Unknown place names and geographic levels are never guessed. */
export function planPlaceRepair(documents: Iterable<Document>, places: PlaceStore): PlaceRepairPlan {
  const uses = new Map<string, number>()
  for (const doc of documents) {
    const refs: unknown[] = [...doc.rel]
    for (const key of ['where', 'location', 'parent']) {
      const value = doc.yaml[key]
      refs.push(...(Array.isArray(value) ? value : [value]))
    }
    const seen = new Set<string>()
    for (const raw of refs) {
      if (typeof raw !== 'string' || !/^places\//i.test(raw.trim())) continue
      const ref = normalizePlaceRef(raw) ?? raw.trim()
      const key = ref.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      uses.set(ref, (uses.get(ref) ?? 0) + 1)
    }
  }
  const create = new Map<string, { ref: string; name: string }>()
  const unresolved: PlaceRepairPlan['unresolved'] = []
  for (const [ref, count] of uses) {
    if (places.findByPlacePath(ref)) continue
    const country = countryPlace(ref)
    if (country && !places.hasPlacePath(ref)) {
      create.set(country.ref!, { ref: country.ref!, name: country.name })
    } else {
      unresolved.push({
        ref,
        uses: count,
        reason: places.hasPlacePath(ref)
          ? 'Several records claim this reference.'
          : 'Needs a place record with a confirmed name and geographic kind.',
      })
    }
  }
  return {
    create: [...create.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
    unresolved: unresolved.sort((a, b) => a.ref.localeCompare(b.ref)),
  }
}
