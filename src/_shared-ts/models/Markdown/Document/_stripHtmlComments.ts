type MarkdownFence = {
  marker: '`' | '~'
  length: number
}

export default function _stripHtmlComments(markdown: string): string {
  // Accumulate into an array + join — string += over thousands of lines
  // leans on engine rope optimizations to stay linear; join guarantees it.
  const output: string[] = []
  let inComment = false
  let inFence: MarkdownFence | null = null
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? []

  for (const line of lines) {
    if (line === '') continue

    if (inFence) {
      output.push(line)
      if (isClosingFence(line, inFence)) {
        inFence = null
      }
      continue
    }

    const fence = !inComment ? fenceForLine(line) : null
    if (fence) {
      output.push(line)
      inFence = fence
      continue
    }

    const stripped = stripHtmlCommentsFromLine(line, inComment)
    output.push(stripped.text)
    inComment = stripped.inComment
  }

  return output.join('')
}

function stripHtmlCommentsFromLine(line: string, startsInComment: boolean): { text: string; inComment: boolean } {
  let text = ''
  let inComment = startsInComment
  let cursor = 0

  while (cursor < line.length) {
    if (inComment) {
      const end = line.indexOf('-->', cursor)
      if (end === -1) {
        cursor = line.length
      } else {
        cursor = end + '-->'.length
        inComment = false
      }
      continue
    }

    const start = line.indexOf('<!--', cursor)
    if (start === -1) {
      text += line.slice(cursor)
      break
    }

    text += line.slice(cursor, start)
    cursor = start + '<!--'.length
    inComment = true
  }

  return { text, inComment }
}

function fenceForLine(line: string): MarkdownFence | null {
  const trimmed = line.trimStart()
  const marker = trimmed[0]
  if (marker !== '`' && marker !== '~') return null

  let length = 0
  while (trimmed[length] === marker) {
    length += 1
  }

  if (length < 3) return null
  return { marker, length }
}

function isClosingFence(line: string, fence: MarkdownFence): boolean {
  const trimmed = line.trim()
  if (trimmed.length < fence.length) return false

  for (const char of trimmed) {
    if (char !== fence.marker) return false
  }

  return true
}
