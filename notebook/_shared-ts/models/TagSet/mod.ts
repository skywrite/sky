import ImmutableSet from '../ImmutableSet/mod.ts'

export const TAG_SEP = ';'

export default class TagSet extends ImmutableSet<string> {
  constructor() {
    super()
  }

  public override toString = (): string => {
    return Array.from(this)
      .map((tag) => String(tag))
      .join(TAG_SEP + ' ')
  }

  static fromArray(array: string[]): TagSet {
    // tags can't have whitespace, so trim()
    let arr = array.map((item) => {
      if (typeof item === 'string') return item.trim()
      else return item
    })

    // remove falsey values / empty strings
    arr = arr.filter((item) => item)

    return ImmutableSet._fromArray(TagSet, arr)
  }

  static fromString(tagSet: string): TagSet {
    return TagSet.fromArray(tagSet.split(TAG_SEP))
  }

  static fromUnknown(tagSet: unknown): TagSet {
    if (typeof tagSet === 'undefined') return new TagSet()
    if (tagSet === null) return new TagSet()

    if (Array.isArray(tagSet)) return TagSet.fromArray(tagSet)

    if (typeof tagSet == 'string') return TagSet.fromString(tagSet)

    throw new Error(`fromUnknown(): ${tagSet} unsupported type.`)
  }

  static isValidTag(tag: string): boolean {
    // VALIDATION APPROACH: Permissive
    // We use a permissive validation strategy - tags can contain ANY characters
    // except for technical constraints. This allows maximum flexibility for users
    // to create tags like "C++", "Q&A", "50%", "@mentions", "#hashtags", etc.
    //
    // Technical constraints (what tags CANNOT have):
    // - Semicolons (;) - used as the tag separator in storage
    // - Empty strings or only whitespace
    //
    // Examples of valid tags:
    // - "Russian Invasion" (spaces)
    // - "Assets/ETH" (forward slashes)
    // - "v1.0.0" (dots)
    // - "namespace:tag" (colons)
    // - "C++" (plus signs)
    // - "50%" (percent signs)
    // - "@john" (at signs)
    // - "#trending" (hash signs)
    // - "Q&A" (ampersands)

    if (!tag || !tag.trim()) return false
    if (tag.includes(TAG_SEP)) return false

    return true
  }

  static EMPTY = new TagSet()
}
