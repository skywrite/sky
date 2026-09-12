import { Lexer, Tokenizer, type Token, type Tokens } from 'marked'

/** Keep source links usable in Markdown without accepting non-web URL schemes. */
export function slackSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href.replaceAll('<', '%3C').replaceAll('>', '%3E')
  } catch {
    return undefined
  }
}

/** A path relative to the day's attachments, including an optional follow folder. */
export function isSlackAttachmentPath(file: string): boolean {
  return (
    !!file &&
    !/[\\:\u0000-\u001f]/.test(file) &&
    file.split('/').every((part) => !!part && part !== '.' && part !== '..')
  )
}

export function slackFileHref(file: string): string {
  if (!isSlackAttachmentPath(file)) throw new Error('Invalid Slack attachment path.')
  return file.split('/').map(encodeURIComponent).join('/')
}

/** Change local link destinations only; retain labels, summaries, examples and line endings. */
export function relocateSlackFileLinks(markdown: string, files: ReadonlyMap<string, string>): string {
  if (!files.size) return markdown
  const tokenizer = new Tokenizer()
  const lexer = new Lexer({
    tokenizer,
    extensions: {
      renderers: {},
      childTokens: {},
      block: [
        function (source) {
          const definition = tokenizer.def(source)
          if (!definition) return
          this.lexer.tokens.links[definition.tag] ??= { href: definition.href, title: definition.title }
          return { ...definition, type: 'slack-definition' }
        },
      ],
    },
  })
  const offsets: number[] = []
  let normalized = ''
  for (let i = 0; i < markdown.length; i++) {
    offsets.push(i)
    normalized += markdown[i] === '\r' ? '\n' : markdown[i]
    if (markdown[i] === '\r' && markdown[i + 1] === '\n') i++
  }
  offsets.push(markdown.length)
  const edits: { start: number; end: number; text: string }[] = []
  const visit = (token: Token, at: number) => {
    if (token.type === 'link' || token.type === 'image' || token.type === 'slack-definition') {
      const href = (token as Tokens.Link).href
      let file: string
      try {
        file = decodeURIComponent(href)
      } catch {
        return
      }
      const replacement = files.get(file)
      if (!replacement || replacement === file) return
      // Reference uses stay untouched; their definition supplies the destination.
      const start = token.type === 'slack-definition' ? token.raw.indexOf(']:') + 2 : token.raw.lastIndexOf('](') + 2
      if (start < 2) return
      const destination = token.raw.slice(start).match(/^(\s*<?)(\S+)/)
      if (!destination) throw new Error('Cannot locate Slack attachment link destination.')
      const offset = start + destination[1].length
      if (!token.raw.startsWith(href, offset))
        throw new Error('Cannot safely relocate an edited Slack attachment link.')
      edits.push({
        start: offsets[at + offset],
        end: offsets[at + offset + href.length],
        text: slackFileHref(replacement),
      })
      return
    }
    const children = (token as Tokens.Generic).tokens as Token[] | undefined
    let cursor = 0
    for (const child of children ?? []) {
      const index = token.raw.indexOf(child.raw, cursor)
      if (index < 0) continue
      visit(child, at + index)
      cursor = index + child.raw.length
    }
  }
  let at = 0
  for (const token of lexer.lex(normalized)) {
    if (!normalized.startsWith(token.raw, at)) throw new Error('Cannot locate Slack Markdown block in source.')
    visit(token, at)
    at += token.raw.length
  }
  if (at !== normalized.length) throw new Error('Cannot safely relocate Slack attachment links.')
  for (const edit of edits.toReversed()) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end)
  return markdown
}
