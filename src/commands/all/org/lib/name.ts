/** Filesystem-safe stem derived from the org name; the slug is its lowercased form. */
export function nameToFileStem(name: string): string {
  return name
    .replace(/&/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Two organizations never share a name. Names are the same when they would share a file name:
 * case, spacing and punctuation aside, so "Atlas Inc" and "Atlas, Inc." are one name.
 */
export function orgNameKey(name: string): string {
  return nameToFileStem(name.trim()).toLowerCase() || name.trim().toLowerCase()
}
