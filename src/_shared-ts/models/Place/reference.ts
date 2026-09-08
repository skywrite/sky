/** Read a logical place reference, including older file-shaped spellings. */
export function normalizePlaceRef(raw: string): string | undefined {
  const ref = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.md$/i, '')
    .replace(/^places\/locations\//i, 'places/')
  if (!/^places\//i.test(ref)) return undefined
  const parts = ref.slice('places/'.length).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part))) return undefined
  if (/^[a-z]{2}$/i.test(parts[0]!)) parts[0] = parts[0]!.toUpperCase()
  return `places/${parts.join('/')}`
}
