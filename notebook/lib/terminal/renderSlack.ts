import { Marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

/**
 * Convert Slack mrkdwn to standard Markdown.
 *
 * Handles: bold, strikethrough, links, mentions, channels, HTML entities,
 * and decorative separator lines. Preserves code spans and blocks.
 */
export function slackToMarkdown(text: string): string {
  // Protect code blocks and inline code from transformation
  const PH_CB = '«CODEBLOCK_'
  const PH_CS = '«CODESPAN_'
  const PH_END = '»'

  const codeBlocks: string[] = []
  let s = text.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m)
    return `${PH_CB}${codeBlocks.length - 1}${PH_END}`
  })
  const codeSpans: string[] = []
  s = s.replace(/`[^`]+`/g, (m) => {
    codeSpans.push(m)
    return `${PH_CS}${codeSpans.length - 1}${PH_END}`
  })

  // Decorative separator lines: *===* or *---* etc → horizontal rule
  s = s.replace(/^\*[=\-]{3,}\*$/gm, '---')

  // Slack bold *text* → Markdown **text** (not inside words/urls)
  // Match *text* where text doesn't start/end with space and isn't empty
  s = s.replace(/(^|[\s(])\*(\S(?:[^*]*?\S)?)\*([\s).,!?:;]|$)/g, '$1**$2**$3')

  // Slack strikethrough ~text~ → Markdown ~~text~~
  s = s.replace(/(^|[\s(])~(\S(?:[^~]*?\S)?)~([\s).,!?:;]|$)/g, '$1~~$2~~$3')

  // Slack links: <url|label> → [label](url)
  s = s.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)')
  // Slack bare links: <url> → url
  s = s.replace(/<(https?:\/\/[^>]+)>/g, '$1')

  // User mentions: <@U...> → @user
  s = s.replace(/<@U[A-Z0-9]+>/g, '@user')

  // Channel mentions: <#C...|name> → #name
  s = s.replace(/<#C[A-Z0-9]+\|([^>]+)>/g, '#$1')

  // Special mentions
  s = s.replace(/<!here>/g, '@here')
  s = s.replace(/<!channel>/g, '@channel')
  s = s.replace(/<!everyone>/g, '@everyone')

  // HTML entities
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')

  // Restore code blocks and spans
  s = s.replace(new RegExp(`${PH_CB}(\\d+)${PH_END}`, 'g'), (_, i) => codeBlocks[Number(i)])
  s = s.replace(new RegExp(`${PH_CS}(\\d+)${PH_END}`, 'g'), (_, i) => codeSpans[Number(i)])

  return s
}

/**
 * Render a Slack mrkdwn message as ANSI-formatted terminal output.
 * Converts Slack → Markdown → terminal ANSI codes.
 */
export function renderSlackForTerminal(text: string): string {
  const md = slackToMarkdown(text)
  const marked = new Marked(markedTerminal())
  const result = marked.parse(md) as string
  // marked-terminal adds a trailing newline; trim it for inline use
  return result.trimEnd()
}
