/**
 * Lightweight, character-exact Markdown tokenizer for the Raw plain-text overlay.
 *
 * Invariant: concatenating every token's `text` per line and joining with `\n`
 * always equals the original source string byte for byte, so the `<pre>`
 * highlight layer aligns 1-to-1 with the transparent `<textarea>` above it.
 */

export type MarkdownTokenKind =
  | 'plain'
  | 'punct'
  | 'heading'
  | 'strong'
  | 'em'
  | 'strike'
  | 'code'
  | 'fence'
  | 'link-text'
  | 'link-url'
  | 'bullet'
  | 'check-open'
  | 'check-done'
  | 'done-text'
  | 'quote'
  | 'hr'
  | 'frontmatter-key'

export interface MarkdownToken {
  kind: MarkdownTokenKind
  text: string
}

function push(tokens: MarkdownToken[], kind: MarkdownTokenKind, text: string) {
  if (!text) return
  const prev = tokens[tokens.length - 1]
  if (prev && prev.kind === kind) prev.text += text
  else tokens.push({ kind, text })
}

function tokenizeInline(line: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  let i = 0
  const len = line.length

  while (i < len) {
    const ch = line[i]!

    // Inline code: `...`
    if (ch === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1 && end > i + 1) {
        push(tokens, 'punct', '`')
        push(tokens, 'code', line.slice(i + 1, end))
        push(tokens, 'punct', '`')
        i = end + 1
        continue
      }
    }

    // Image or link: ![alt](url) or [label](url)
    if (ch === '[' || (ch === '!' && line[i + 1] === '[')) {
      const prefix = ch === '!' ? '![' : '['
      const labelStart = i + prefix.length
      const closeBracket = line.indexOf(']', labelStart)
      if (closeBracket !== -1 && line[closeBracket + 1] === '(') {
        const closeParen = line.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          push(tokens, 'punct', prefix)
          push(tokens, 'link-text', line.slice(labelStart, closeBracket))
          push(tokens, 'punct', '](')
          push(tokens, 'link-url', line.slice(closeBracket + 2, closeParen))
          push(tokens, 'punct', ')')
          i = closeParen + 1
          continue
        }
      }
    }

    // Bold: **...**
    if (ch === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2)
      if (end !== -1 && end > i + 2) {
        push(tokens, 'punct', '**')
        push(tokens, 'strong', line.slice(i + 2, end))
        push(tokens, 'punct', '**')
        i = end + 2
        continue
      }
    }

    // Strikethrough: ~~...~~
    if (ch === '~' && line[i + 1] === '~') {
      const end = line.indexOf('~~', i + 2)
      if (end !== -1 && end > i + 2) {
        push(tokens, 'punct', '~~')
        push(tokens, 'strike', line.slice(i + 2, end))
        push(tokens, 'punct', '~~')
        i = end + 2
        continue
      }
    }

    // Italic: *...*
    if (ch === '*' && line[i + 1] !== '*' && line[i + 1] !== ' ' && line[i + 1] !== undefined) {
      const end = line.indexOf('*', i + 1)
      if (end !== -1 && end > i + 1 && line[end - 1] !== ' ') {
        push(tokens, 'punct', '*')
        push(tokens, 'em', line.slice(i + 1, end))
        push(tokens, 'punct', '*')
        i = end + 1
        continue
      }
    }

    push(tokens, 'plain', ch)
    i += 1
  }

  return tokens
}

function splitCr(line: string): [string, string] {
  return line.endsWith('\r') ? [line.slice(0, -1), '\r'] : [line, '']
}

function withCr(tokens: MarkdownToken[], cr: string): MarkdownToken[] {
  if (cr) push(tokens, 'plain', cr)
  return tokens
}

/** Tokenize a Markdown document line by line without ever adding or dropping characters. */
export function tokenizeMarkdown(text: string): MarkdownToken[][] {
  if (text === '') return []
  const lines = text.split('\n')

  // Detect optional YAML frontmatter block starting on line 0 (`---` ... `---`).
  let frontmatterEnd = -1
  if (splitCr(lines[0]!)[0] === '---') {
    for (let idx = 1; idx < lines.length; idx += 1) {
      const [body] = splitCr(lines[idx]!)
      if (body === '---' || body === '...') {
        frontmatterEnd = idx
        break
      }
    }
  }

  let inFence = false
  return lines.map((rawLine, index) => {
    const [line, cr] = splitCr(rawLine)

    if (frontmatterEnd !== -1 && index <= frontmatterEnd) {
      if (index === 0 || index === frontmatterEnd) {
        return withCr([{ kind: 'punct', text: line }], cr)
      }
      const pair = line.match(/^(\s*[A-Za-z0-9_-]+)(:)(.*)$/)
      if (pair) {
        const tokens: MarkdownToken[] = []
        push(tokens, 'frontmatter-key', pair[1]!)
        push(tokens, 'punct', pair[2]!)
        push(tokens, 'quote', pair[3]!)
        return withCr(tokens, cr)
      }
      return withCr([{ kind: 'quote', text: line }], cr)
    }

    // Fenced code blocks: ```lang
    const fence = line.match(/^(\s*)(```+|~~~+)(.*)$/)
    if (fence) {
      inFence = !inFence
      const tokens: MarkdownToken[] = []
      push(tokens, 'plain', fence[1]!)
      push(tokens, 'punct', fence[2]!)
      push(tokens, 'em', fence[3]!)
      return withCr(tokens, cr)
    }
    if (inFence) {
      return withCr(line ? [{ kind: 'fence', text: line }] : [], cr)
    }

    // Horizontal rule
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      return withCr([{ kind: 'hr', text: line }], cr)
    }

    // Headings
    const heading = line.match(/^(#{1,6})([ \t]+)(.*)$/)
    if (heading) {
      const tokens: MarkdownToken[] = []
      push(tokens, 'punct', heading[1]!)
      push(tokens, 'plain', heading[2]!)
      push(tokens, 'heading', heading[3]!)
      return withCr(tokens, cr)
    }

    // Checklist items
    const task = line.match(/^(\s*[-*+]\s+)(\[[ xX]\])(\s+)(.*)$/)
    if (task) {
      const done = task[2]!.toLowerCase() === '[x]'
      const tokens: MarkdownToken[] = []
      push(tokens, 'punct', task[1]!)
      push(tokens, done ? 'check-done' : 'check-open', task[2]!)
      push(tokens, 'plain', task[3]!)
      if (done) push(tokens, 'done-text', task[4]!)
      else {
        for (const token of tokenizeInline(task[4]!)) push(tokens, token.kind, token.text)
      }
      return withCr(tokens, cr)
    }

    // Bullet or numbered lists
    const list = line.match(/^(\s*(?:[-*+]|\d+\.))([ \t]+)(.*)$/)
    if (list) {
      const tokens: MarkdownToken[] = []
      push(tokens, 'bullet', list[1]!)
      push(tokens, 'plain', list[2]!)
      for (const token of tokenizeInline(list[3]!)) push(tokens, token.kind, token.text)
      return withCr(tokens, cr)
    }

    // Blockquotes
    const quote = line.match(/^(\s*>+)(\s?)(.*)$/)
    if (quote) {
      const tokens: MarkdownToken[] = []
      push(tokens, 'punct', quote[1]!)
      push(tokens, 'plain', quote[2]!)
      push(tokens, 'quote', quote[3]!)
      return withCr(tokens, cr)
    }

    return withCr(tokenizeInline(line), cr)
  })
}
