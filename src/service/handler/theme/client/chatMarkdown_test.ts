import { assert, test } from '#test'
import { renderChatMarkdown } from './chatMarkdown.ts'
import { renderStatic } from './wysiwyg/render.ts'

test('chat markdown renders a legacy Slack draft as readable prose', () => {
  const source = [
    'Here is the draft:',
    '',
    '```',
    '*Atlas update*',
    '*============*',
    '',
    'The plan is ready for review. Please read <https://example.com/plan|the plan>.',
    '',
    '1. Review the proposal.',
    '2. Confirm the owner.',
    '',
    '*Next steps*: _review_ before ~sending~.',
    '```',
    '',
    'A note after the draft.',
  ].join('\n')
  assert({
    given: 'an existing reply containing a fenced Slack draft and surrounding commentary',
    should: 'quote the formatted draft while leaving commentary outside, without a code block or underline',
    actual: renderChatMarkdown(source),
    expected: [
      '<p>Here is the draft:</p>',
      '<blockquote><p><strong>Atlas update</strong></p>',
      '<p>The plan is ready for review. Please read <a href="https://example.com/plan">the plan</a>.</p>',
      '<ol start="1"><li>Review the proposal.  </li>\n<li>Confirm the owner.</li></ol>',
      '<p><strong>Next steps</strong>: <em>review</em> before <del>sending</del>.</p></blockquote>',
      '<p>A note after the draft.</p>',
    ].join('\n'),
  })
})

test('chat markdown recognizes explicit Slack fences and legacy plain-text labels', () => {
  for (const language of ['', 'text', 'plaintext', 'markdown', 'md', 'slack', 'mrkdwn']) {
    assert({
      given: `a ${language || 'bare'} draft fence using CRLF and tilde markers`,
      should: 'show the formatted subject and body',
      actual: renderChatMarkdown(`~~~${language}\r\n*Atlas update*\r\n*============*\r\n\r\nReady.\r\n~~~`),
      expected: '<blockquote><p><strong>Atlas update</strong></p>\n<p>Ready.</p></blockquote>',
    })
  }
  assert({
    given: 'a Slack-labelled draft inside a quote without the legacy subject convention',
    should: 'render its formatting within the existing quote without nesting another review quote',
    actual: renderChatMarkdown('> ```slack\n> *Ready*\n> • Review\n> ```'),
    expected: '<blockquote><p><strong>Ready</strong>  </p>\n<ul><li>Review</li></ul></blockquote>',
  })
})

test('chat markdown keeps code, structured data, and ordinary Markdown unchanged', () => {
  for (const source of [
    '### Draft\n\n**Ready** for review.\n\n- First step\n- Second step',
    'Here is the draft:\n\n> **Atlas update**\n>\n> Ready for review.\n>\n> - First step\n> - Second step\n\nA note after the draft.',
    '```typescript\nconst subject = "*Atlas update*"\nconsole.log(subject)\n```',
    '```json\n{"title":"*Atlas update*","ready":true}\n```',
    '```\nconst total = 3 * 4\n```',
    '```text\nNAME       STATUS\nAtlas      Ready\n```',
    '```markdown\n# Heading\n\n**bold** and _italic_\n```',
    '    *Atlas update*\n    *============*\n\n    indented code',
  ]) {
    assert({
      given: 'a reply without a Slack draft fence',
      should: 'retain the standard Markdown rendering',
      actual: renderChatMarkdown(source),
      expected: renderStatic(source),
    })
  }
})

test('chat markdown escapes HTML and retains code quoted inside a Slack draft', () => {
  assert({
    given: 'a Slack draft containing raw HTML, inline code, and a nested fenced code sample',
    should: 'keep HTML inert and code literal',
    actual: renderChatMarkdown(
      '````slack\n*Review*\n\n<script>alert(1)</script>\n\nKeep `*literal*` as code.\n\n```js\nconst value = "*literal*"\n```\n````',
    ),
    expected: [
      '<blockquote><p><strong>Review</strong></p>',
      '<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>',
      '<p>Keep <code>*literal*</code> as code.</p>',
      '<pre><code class="language-js">const value = "*literal*"</code></pre></blockquote>',
    ].join('\n'),
  })
})
