import { isMap, parseDocument } from 'yaml'

/** Change rel alone, retaining other properties, comments and the exact markdown body. */
export function changeLinks(
  content: string,
  add: string[],
  remove: string[],
  identity: (value: string) => string = (v) => v,
): string {
  const match = /^(\uFEFF?---[ \t]*\r?\n)((?:[^\n]*\n)*?)(---[ \t]*(?:\r?\n|$))/.exec(content)
  if (!match && /^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(content))
    throw new Error('Close the document’s YAML frontmatter before changing links.')
  const yaml = parseDocument(match?.[2] ?? '')
  if (yaml.errors.length > 0 || (yaml.contents && !isMap(yaml.contents)))
    throw new Error('Fix the document’s YAML before changing links.')
  const raw = yaml.get('rel')
  const value =
    raw && typeof raw === 'object' && 'toJSON' in raw && typeof raw.toJSON === 'function' ? raw.toJSON() : raw
  if (value != null && typeof value !== 'string' && (!Array.isArray(value) || value.some((v) => typeof v !== 'string')))
    throw new Error('The rel field must contain names or file references.')
  const existing: string[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : []
  const removed = new Set(remove.map(identity))
  const next = existing.filter((v) => !removed.has(identity(v)))
  const seen = new Set(next.map(identity))
  for (const link of add) {
    if (!seen.has(identity(link))) {
      next.push(link)
      seen.add(identity(link))
    }
  }
  if (JSON.stringify(existing) === JSON.stringify(next)) return content
  yaml.set('rel', next)
  const newline = match?.[1].includes('\r') ? '\r\n' : '\n'
  const frontmatter = yaml.toString({ lineWidth: 0 }).trimEnd().replace(/\r?\n/g, newline)
  return match
    ? `${match[1]}${frontmatter}${newline}${match[3]}${content.slice(match[0].length)}`
    : `---${newline}${frontmatter}${newline}---${newline}${newline}${content}`
}
