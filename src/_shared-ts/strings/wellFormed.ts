/**
 * Replace unpaired surrogates with U+FFFD throughout a JSON-shaped value.
 *
 * An emoji is stored as two UTF-16 code units. Split them — by truncating on a
 * code-unit boundary, or by decoding a partial buffer — and the survivor is a
 * lone surrogate: not a character, just an orphan half. `JSON.stringify`
 * escapes it as an unpaired `\uD83D`, and model APIs reject the entire request
 * body over one of them ("no low surrogate in string"), so a single stray half
 * fails a whole call. U+FFFD (the replacement character) is what any UTF-8
 * decoder would have produced for the same bytes.
 *
 * Intact emoji never match — a well-formed pair is left exactly as it is. This
 * only ever touches halves that are already broken.
 *
 * Returns the *same reference* when nothing needs repair, so the common case
 * allocates nothing and callers can use `===` to detect a rewrite. Traverses
 * arrays and plain objects only: class instances (`Uint8Array` file payloads,
 * `Date`, `AbortSignal`) pass through untouched rather than being cloned into
 * plain objects.
 *
 * @see truncate — prevents the split; this repairs one that already happened
 */
export default function wellFormed<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.isWellFormed() ? value : value.toWellFormed()) as T
  }

  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((item) => {
      const next = wellFormed(item)
      if (next !== item) changed = true
      return next
    })
    return (changed ? out : value) as T
  }

  if (isPlainObject(value)) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const next = wellFormed(item)
      if (next !== item) changed = true
      out[key] = next
    }
    return (changed ? out : value) as T
  }

  return value
}

/** Object literals and null-prototype objects only — anything with a class behind it is left alone. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
