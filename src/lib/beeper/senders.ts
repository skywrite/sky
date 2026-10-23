/**
 * Who a message's sender is, by the handle a messenger shows — a phone
 * number or an address — in the order Sky trusts: the notebook's own people
 * records first (`email:` and `phone:`), then this Mac's contacts, whose
 * cards can also lead to a record through an address the record carries.
 * A name from the notebook is the name the notebook uses for that person,
 * whatever the phone calls them; it outranks the messenger's own name.
 */

import type { MacSenderLookup } from '#lib/macMessages/mod.ts'
import type PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import type { SenderNames } from './capture.ts'

/** The name the notebook files a person under: the first name on the record */
function recordName(people: PeopleStore, handle: string): string | null {
  const found = people.findByHandle(handle)
  const name = found?.value.names.find((name): name is string => typeof name === 'string' && name.trim() !== '')
  return name?.trim() ?? null
}

export function notebookSenderNames(people: PeopleStore | null, mac: MacSenderLookup | null): SenderNames {
  return {
    resolve(handle) {
      const own = people ? recordName(people, handle) : null
      if (own) return { name: own, known: true, source: 'notebook' }
      const card = mac?.resolve(handle) ?? null
      if (card && people) {
        for (const linked of card.handles) {
          const viaCard = recordName(people, linked)
          if (viaCard) return { name: viaCard, known: true, source: 'notebook' }
        }
      }
      if (!card) return null
      return { name: card.name, known: card.known, source: 'contacts' }
    },
  }
}
