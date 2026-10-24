import { slugify } from '#lib/string/mod.ts'
import { buildPlacePath, type PlaceDocument } from '#shared/models/Place/mod.ts'

/** Places use geographic, name-based identities rather than capture timestamps. */
export function placeCreationPath(
  place: Pick<PlaceDocument, 'name' | 'kind' | 'location' | 'type' | 'parent'>,
): string {
  const slug = (value: string) => slugify(value, { preserveCase: true }).slice(0, 100)
  const location = place.location
  const directory =
    place.kind === 'venue' && location?.country
      ? buildPlacePath(location, place.type).split('/').filter(Boolean).map(slug).filter(Boolean).join('/')
      : [place.parent?.slice('places/'.length), place.kind === 'venue' ? slug(place.type) : '']
          .filter(Boolean)
          .join('/')
  return [directory, slug(place.name) || 'Place'].filter(Boolean).join('/')
}
