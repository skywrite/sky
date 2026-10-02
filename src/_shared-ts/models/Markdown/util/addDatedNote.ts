interface Heading {
  line: number
  level: number
  text: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const DATED = /^\d{4}-\d{2}-\d{2}\b/

/** ATX headings outside fenced code, by line. */
function headings(lines: string[]): Heading[] {
  const found: Heading[] = []
  let fence = ''
  lines.forEach((line, index) => {
    const marker = line.match(FENCE)?.[1]
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = ''
    } else if (marker) {
      fence = marker
    } else {
      const heading = line.match(HEADING)
      if (heading) found.push({ line: index, level: heading[1].length, text: heading[2] ?? '' })
    }
  })
  return found
}

/** The index just past the last non-blank line in `lines[from..to)`. */
function afterContent(lines: string[], from: number, to: number): number {
  let end = to
  while (end > from && !lines[end - 1].trim()) end--
  return end
}

/** Splices `block` in before `lines[at]`, with a blank line on whichever side touches text. */
function insert(lines: string[], at: number, block: string[]): string {
  const before = at > 0 && lines[at - 1].trim() ? [''] : []
  const after = at < lines.length && lines[at].trim() ? [''] : []
  const result = [...lines.slice(0, at), ...before, ...block, ...after, ...lines.slice(at)].join('\n')
  return result.endsWith('\n') ? result : `${result}\n`
}

/**
 * Files a note under the document's `## Notes` section, below a `### YYYY-MM-DD` heading for its day.
 * The newest day comes first, and a day's notes stay in the order they were added. The section is
 * added at the end when the document has none. Every other line stays exactly as it was.
 *
 * `markdown` is the body without its frontmatter: a YAML comment would read as a heading.
 */
export default function addDatedNote(markdown: string, date: string, text: string): string {
  const note = text.trim()
  if (!note) return markdown
  const lines = markdown.split('\n')
  const all = headings(lines)
  const notes = all.find((heading) => heading.level === 2 && /^notes:?$/i.test(heading.text))
  if (!notes) return insert(lines, afterContent(lines, 0, lines.length), ['## Notes', '', `### ${date}`, '', note])

  const end = all.find((heading) => heading.line > notes.line && heading.level <= 2)?.line ?? lines.length
  const days = all.filter((heading) => heading.line > notes.line && heading.line < end && heading.level === 3)
  const today = days.find((heading) => heading.text === date)
  if (today) {
    const dayEnd = all.find((heading) => heading.line > today.line && heading.level <= 3)?.line ?? lines.length
    return insert(lines, afterContent(lines, today.line, dayEnd), [note])
  }
  const older = days.find((heading) => DATED.test(heading.text) && heading.text.slice(0, 10) < date)
  return insert(lines, older ? older.line : afterContent(lines, notes.line, end), [`### ${date}`, '', note])
}
