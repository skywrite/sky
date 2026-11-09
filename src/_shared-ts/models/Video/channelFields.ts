import { isMap, isScalar, parseDocument } from 'yaml'

const CHANNEL_FIELDS = new Set(['who', 'from', 'to'])

/** Recover legacy channel literals before YAML treats their leading # as a comment. */
export function quoteLegacyChannelFields(markdown: string): string {
  const header = markdown.match(/^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$))/)
  if (!header) return markdown
  const front = header[2]
  if (!/:[ \t]+#[a-z0-9]/i.test(front)) return markdown
  const doc = parseDocument(front)
  if (doc.errors.length || !isMap(doc.contents)) return markdown

  const patches: { start: number; end: number; value: string }[] = []
  for (const pair of doc.contents.items) {
    if (
      !isScalar(pair.key) ||
      typeof pair.key.value !== 'string' ||
      !CHANNEL_FIELDS.has(pair.key.value) ||
      !pair.key.range ||
      !isScalar(pair.value) ||
      pair.value.value !== null
    )
      continue
    const offset = pair.key.range[1]
    const newline = front.indexOf('\n', offset)
    const tail = front.slice(offset, newline < 0 ? front.length : newline)
    const channel = tail.match(/^([ \t]*:[ \t]+)(#[a-z0-9][a-z0-9_-]*)([ \t]*\r?)$/i)
    if (!channel) continue
    const start = offset + channel[1].length
    patches.push({ start, end: start + channel[2].length, value: JSON.stringify(channel[2]) })
  }

  let normalized = front
  for (const patch of patches.sort((a, b) => b.start - a.start))
    normalized = normalized.slice(0, patch.start) + patch.value + normalized.slice(patch.end)
  return header[1] + normalized + header[3] + markdown.slice(header[0].length)
}
