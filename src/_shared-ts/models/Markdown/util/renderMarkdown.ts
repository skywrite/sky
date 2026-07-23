import type { Token, Tokens, TokensList } from 'marked'

export type RenderMarkdownOptions = {
  links?: boolean
}

// deno-lint-ignore no-explicit-any
export default function renderMarkdown(
  tokens: TokensList | Token[],
  opts: RenderMarkdownOptions = { links: true },
): string {
  const _tokens = structuredClone(tokens)
  let str = ''
  let topMost = false

  if ((tokens as TokensList).links) topMost = true

  while (_tokens.length > 0) {
    const token = _tokens.shift() as Tokens.Generic
    if (!token?.tokens) {
      str += token.raw
    } else {
      // Use a function for replacement to avoid special $ character interpretation
      // In String.replace(), $$ in the replacement string means "insert a single $"
      str += token.raw.replace(token.text, () => renderMarkdown(token.tokens!))
    }
  }

  if (topMost && opts.links) {
    for (const [label, { href, title }] of Object.entries((tokens as TokensList).links)) {
      if (!title) {
        str += `[${label}]: ${href}\n`
      } else {
        str += `[${label}]: ${href} "${title}"\n`
      }
    }
  }

  return str
}
