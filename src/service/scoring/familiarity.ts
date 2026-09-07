/** Short names require direct contact or an explicit family relationship. */
export const FAMILIAR_NAME_THRESHOLD = 100
export const FAMILY_SCORE_BONUS = 100
export const PERSON_MENTION_MULTIPLIER = 0.1

/** Match the family tag hierarchy, never similarly named groups or the legacy spouse tag. */
export function isFamily(tags: Iterable<string>): boolean {
  for (const tag of tags) {
    const key = tag.trim().toLowerCase()
    if (key === 'person/family' || key.startsWith('person/family/')) return true
  }
  return false
}
