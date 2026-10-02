import { assert, test } from '#test'
import { renderChatMarkdown, renderStreamingChatMarkdown, settleStreamingMarkdown } from './chatMarkdown.ts'
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

test('a reply still being written reads as formatted text, never as raw marks', () => {
  const caret = '<span class="sky-caret" aria-hidden="true"></span>'
  for (const [given, source, expected] of [
    ['bold opened and not yet closed', 'Four tabs: **Visi', [`<p>Four tabs: <strong>Visi${caret}</strong></p>`]],
    ['half of the closing bold mark', 'Four tabs: **Vision*', [`<p>Four tabs: <strong>Vision${caret}</strong></p>`]],
    [
      'a bold mark with nothing after it',
      'Four tabs: **Vision** and **',
      [`<p>Four tabs: <strong>Vision</strong> and ${caret}</p>`],
    ],
    ['bold stopped at a space', 'Four tabs: **What has ', [`<p>Four tabs: <strong>What has${caret}</strong> </p>`]],
    ['italic opened and not yet closed', 'Read *Atlas no', [`<p>Read <em>Atlas no${caret}</em></p>`]],
    ['a code span opened and not yet closed', 'Run `sky day:st', [`<p>Run <code>sky day:st${caret}</code></p>`]],
    [
      'a link whose address is still arriving',
      'See [the plan](https://example.com/pl',
      [`<p>See the plan${caret}</p>`],
    ],
    ['a link whose text is still arriving', 'See [the pl', [`<p>See the pl${caret}</p>`]],
    [
      'a list item being written under finished blocks',
      'Intro:\n\n- one\n- **two',
      ['<p>Intro:</p>', `<ul><li>one</li>\n<li><strong>two${caret}</strong></li></ul>`],
    ],
    ['a list marker arriving straight under a paragraph', 'Intro:\n-', [`<p>Intro:${caret}</p>`]],
    ['arithmetic, which opens nothing', 'It is 2 * 3 and a * b', [`<p>It is 2 * 3 and a * b${caret}</p>`]],
  ] as const) {
    assert({
      given,
      should: 'render the finished form with the caret after the last word',
      actual: renderStreamingChatMarkdown(source),
      expected: [...expected],
    })
  }
})

test('a reply still being written leaves code and finished lines as written', () => {
  assert({
    given: 'marks inside an open code fence, including a shorter fence nested in a longer one',
    should: 'keep them literal',
    actual: [
      settleStreamingMarkdown('```ts\nconst a = **1'),
      settleStreamingMarkdown('````slack\n*Review*\n\n```js\nconst value = `x'),
    ],
    expected: ['```ts\nconst a = **1', '````slack\n*Review*\n\n```js\nconst value = `x'],
  })
  assert({
    given: 'an unclosed mark on an earlier line',
    should: 'settle only the line being written',
    actual: settleStreamingMarkdown('A stray ** here\nand **more'),
    expected: 'A stray ** here\nand **more**',
  })
})

test('a streamed reply arrives at the HTML the finished reply shows', () => {
  const reply = [
    'Four tabs: **Vision** (the vision), `sky day:start`, *Atlas* and [the plan](https://example.com/plan).',
    '## Next',
    '- one **two**\n- three',
    '```ts\nconst a = `x` * 2\n```',
    '| a | b |\n|---|---|\n| 1 | 2 |',
    'Done.',
  ].join('\n\n')
  const raw: string[] = []
  for (let end = 1; end < reply.length; end++) {
    const html = renderStreamingChatMarkdown(reply.slice(0, end)).join('\n')
    const prose = html.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, '')
    if (/\*\*|`|\]\(/.test(prose)) raw.push(reply.slice(0, end))
  }
  assert({
    given: 'a reply cut at every character',
    should: 'never show a raw bold, code or link mark outside a code block',
    actual: raw,
    expected: [],
  })
  assert({
    given: 'the whole reply',
    should: 'match the finished rendering, apart from the caret',
    actual: renderStreamingChatMarkdown(reply)
      .join('\n')
      .replace(/<span class="sky-caret"[^>]*><\/span>/, ''),
    expected: renderChatMarkdown(reply),
  })
})
