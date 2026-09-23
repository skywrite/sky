import { Marked, type Token } from 'marked'

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

// Imported notes may contain HTML or unsafe links; the profile only renders safe Markdown.
const markdown = new Marked({
  renderer: {
    html: () => '',
    link({ href, text, tokens }) {
      const label = tokens ? this.parser.parseInline(tokens) : escapeHtml(text)
      if (!/^(?:https?:\/\/|mailto:|\/explorer\/|#)/i.test(href)) return label
      return `<a href="${escapeHtml(href)}" rel="noreferrer">${label}</a>`
    },
    image: ({ text }) => escapeHtml(text),
  },
})

/** Hide unused template sections and old heading echoes without changing the notebook file. */
export function renderProfileNotes(body: string): string {
  const tokens = markdown.lexer(body.replace(/^\s*# [^\n]+\n/, ''))
  const label = (text: string) => text.trim().replace(/[.:]$/, '').toLowerCase()
  for (let i = 0; i < tokens.length; i++) {
    const heading = tokens[i]
    if (heading.type !== 'heading') continue
    let next = i + 1
    while (tokens[next]?.type === 'space') next++
    const echo = tokens[next]
    if ((echo?.type === 'paragraph' || echo?.type === 'heading') && label(echo.text) === label(heading.text))
      tokens.splice(next, 1)
  }
  const hasContent = (token: Token) => {
    if (['heading', 'space', 'hr'].includes(token.type)) return false
    if (token.type === 'paragraph' && !token.text.replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/gm, '').trim())
      return false
    return Boolean(
      markdown
        .parser([token])
        .replace(/<[^>]*>/g, '')
        .trim(),
    )
  }
  for (let i = tokens.length - 1; i >= 0; i--) {
    const heading = tokens[i]
    if (heading.type !== 'heading') continue
    let end = i + 1
    while (end < tokens.length) {
      const next = tokens[end]
      if (next.type === 'heading' && next.depth <= heading.depth) break
      end++
    }
    if (!tokens.slice(i + 1, end).some(hasContent)) tokens.splice(i, end - i)
  }
  return markdown.parser(tokens).trim()
}
