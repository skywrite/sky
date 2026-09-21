import * as path from 'node:path'
import { Lexer, type Token } from 'marked'
import Document from '#shared/models/Markdown/Document/mod.ts'

/** Inline references before moving: their labels and relative paths belong to the source file. */
export function moveItemMarkdown(raw: string, content: string, from: string, to: string): string {
  const lexer = new Lexer()
  lexer.tokens.links = Object.fromEntries([...Document.fromMarkdown(content).links].map(([key, link]) => [key, link]))
  const href = (value: string): string => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) return value
    const [, file, suffix] = /^([^?#]*)(.*)$/.exec(value)!
    return path.relative(path.dirname(to), file ? path.resolve(path.dirname(from), file) : from) + suffix
  }
  const render = (token: Token): string => {
    if (token.type === 'link' || token.type === 'image') {
      const label = token.type === 'image' ? token.text : (token.tokens?.map(render).join('') ?? token.text)
      const url = href(token.href).replace(/[\s()<>]/g, (character) =>
        encodeURIComponent(character).replace('(', '%28').replace(')', '%29'),
      )
      const title = token.title ? ` "${token.title.replace(/"/g, '&quot;')}"` : ''
      return `${token.type === 'image' ? '!' : ''}[${label}](${url}${title})`
    }
    if ('tokens' in token && Array.isArray(token.tokens)) {
      let cursor = 0
      let result = ''
      for (const child of token.tokens as Token[]) {
        const at = token.raw.indexOf(child.raw, cursor)
        if (at < 0) continue
        result += token.raw.slice(cursor, at) + render(child)
        cursor = at + child.raw.length
      }
      return result + token.raw.slice(cursor)
    }
    return token.raw
  }
  return lexer.inlineTokens(raw).map(render).join('')
}
