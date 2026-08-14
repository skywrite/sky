const HEADING = '## Week-Next'

/**
 * Append deferred items to a next-* file's `## Week-Next` section — the one
 * section the week-planning flow owns. Append-only: nothing else in the file
 * is touched, nothing is reordered or deleted, and the section is targeted by
 * heading so the user may move it anywhere. Created after the H1 (or at the
 * top of a bare file) when absent. Items already present are skipped.
 */
export function appendWeekNext(fileText: string, items: string[], weekId: string): string {
  if (!items.length) return fileText

  const lines = fileText.split('\n')
  let headingIdx = lines.findIndex((line) => line.trim() === HEADING)

  if (headingIdx === -1) {
    const h1 = lines.findIndex((line) => line.startsWith('# '))
    const insertAt = h1 === -1 ? 0 : h1 + 1
    lines.splice(insertAt, 0, '', HEADING)
    headingIdx = insertAt + 1
  }

  // section ends at the next H2 (or EOF); insert before its trailing blanks
  let sectionEnd = lines.length
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      sectionEnd = i
      break
    }
  }

  const section = lines.slice(headingIdx, sectionEnd).join('\n')
  const fresh = items.filter((item) => !section.includes(`- ${item}`))
  if (!fresh.length) return lines.join('\n')

  let insertAt = sectionEnd
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--

  lines.splice(insertAt, 0, ...fresh.map((item) => `- ${item} (pushed ${weekId})`))
  return lines.join('\n')
}
