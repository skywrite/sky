import { DIR_PLACES } from '#config'
import type { LocationResolution } from '#shared/models/Person/write.ts'
import PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import { ensurePlaceRef } from './geography.ts'
import { matchLocation } from './locations.ts'

/**
 * Resolves the locations AI profile updates write against the notebook's saved places, read from
 * disk once, when the first location needs them. A recognized country is created on first use;
 * any other place must already be saved — it is never invented from a conversation.
 */
export function notebookLocations(placesDir: string = DIR_PLACES): (text: string) => Promise<LocationResolution> {
  let places: Promise<PlaceStore> | undefined
  return async (text) => {
    places ??= PlaceStore.build(placesDir)
    const store = await places
    const match = matchLocation(store, text)
    if (!match) return { reason: `“${text}” is not a saved place (add it in Places)` }
    if (!match.needsCreation) return { ref: match.ref, label: match.label }
    const saved = await ensurePlaceRef(store, match.ref)
    return { ref: saved.ref, label: match.label }
  }
}
