/**
 * The handles a person record carries — phone numbers and email addresses —
 * as keys a message's sender can be matched on, whatever the formatting.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A handle as a key: an address lower-cased; a number as its digits, with
 * the North American country code dropped because contacts often leave it
 * out where messengers write it. Empty when there is nothing to key on.
 */
export function handleKey(handle: string): string {
  const plain = handle.trim()
  if (plain.includes('@')) return plain.toLowerCase()
  const digits = plain.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Every string inside a frontmatter value: a scalar, a list, or personal/business lines of either. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

/** The keys of a record's `email:` and `phone:` fields; a number needs at least seven digits to count. */
export function recordHandleKeys(email: unknown, phone: unknown): string[] {
  const keys = new Set<string>()
  for (const raw of strings(email))
    for (const part of raw.split(/[;,\s]+/)) if (EMAIL.test(part)) keys.add(handleKey(part))
  for (const raw of strings(phone)) {
    for (const part of raw.split(/[;,]+/)) {
      const key = handleKey(part)
      if (/^\d{7,}$/.test(key)) keys.add(key)
    }
  }
  return [...keys]
}
