import { assert, test } from '#test'
import { HIGHLIGHT_LIMIT, highlightCode, highlightLanguage } from './highlight.ts'
import { renderFenceContent } from './render.ts'

/** The text an HTML fragment carries — tags dropped, the entities highlight.js writes read back. */
function textOfHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

test({ name: 'FEN-1 — the language of a fence resolves by name or alias, however it is written' }, () => {
  assert({
    given: 'info strings as the notebook writes them: capitalized, aliased, with attributes, plain, unknown, empty',
    should: 'name what highlight.js colors by, and null for plain text and languages it does not know',
    actual: [
      'JavaScript',
      'js',
      'ts',
      'tsx',
      'sh',
      'zsh',
      'yml',
      'html',
      'py',
      'json {.numberLines}',
      'text',
      'Excel',
      'mermaid',
      '',
      undefined,
    ].map(highlightLanguage),
    expected: ['javascript', 'js', 'ts', 'tsx', 'sh', 'zsh', 'yml', 'html', 'py', 'json', null, null, null, null, null],
  })
})

test({ name: 'FEN-1 — highlighting wraps tokens in spans and changes no character of the code' }, () => {
  const code = `const s = "<a & b>" // it's 'x'\n\ty = 1\n`
  const html = highlightCode(code, 'ts') ?? ''
  assert({
    given: 'TypeScript with quotes, angle brackets, an ampersand, a comment, a tab and a trailing newline',
    should: 'read back as the same text, with string and comment tokens marked',
    actual: [textOfHtml(html) === code, html.includes('hljs-string'), html.includes('hljs-comment')],
    expected: [true, true, true],
  })
  assert({
    given: 'code past the size limit, and an unknown language',
    should: 'stay uncolored',
    actual: [highlightCode('x'.repeat(HIGHLIGHT_LIMIT + 1), 'js'), highlightCode('x', 'nope')],
    expected: [null, null],
  })
})

test({ name: 'FEN-1 — a fence renders colored, with the guards every verbatim block needs' }, () => {
  const trailing = renderFenceContent("say('hi')\n", 'JavaScript')
  assert({
    given: 'code ending in a newline, code starting with one, and no code',
    should:
      'keep the text, mark the string, end on a line box, double the leading newline, and show one line box when empty',
    actual: [
      textOfHtml(trailing),
      trailing.includes('hljs-string'),
      trailing.endsWith('<br>'),
      textOfHtml(renderFenceContent('\nx', 'js')),
      renderFenceContent('', 'js'),
    ],
    expected: ["say('hi')\n", true, true, '\n\nx', '<br>'],
  })
})
