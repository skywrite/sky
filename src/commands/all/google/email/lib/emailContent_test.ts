import { assert, test } from '#test'
import { emailMarkdown, keepBetween } from './emailContent.ts'

const newsletter = `<!doctype html><html><head><style>td { color: red }</style></head><body>
<table><tr><td><a href="https://example.com/view?id=1">View in browser</a></td></tr>
<tr><td><img src="https://example.com/logo.png" alt="Atlas Weekly"></td></tr>
<tr><td><h1>The Atlas Field Guide</h1>
<p>Most maps are wrong in 2026. That’s the <b>point</b> of a <a href="https://example.com/r/abc">field guide</a>.</p>
<ul><li>Walk first</li><li>Draw second</li></ul>
<p>2. Keep the sketch.</p>
<p>See you next week.</p></td></tr>
<tr><td><p>You received this because you subscribed. <a href="https://example.com/unsub">Unsubscribe</a></p></td></tr></table>
</body></html>`

test('emailMarkdown - a table-laid newsletter becomes plain markdown paragraphs', () => {
  assert({
    given: 'newsletter HTML laid out in table cells, with a logo image and tracking links',
    should: 'keep the words and formatting, without table pipes, images, or link targets',
    actual: emailMarkdown({ bodyHtml: newsletter }),
    expected: [
      'View in browser',
      '# The Atlas Field Guide',
      'Most maps are wrong in 2026. That’s the **point** of a field guide.',
      '- Walk first\n- Draw second',
      '2\\. Keep the sketch.',
      'See you next week.',
      'You received this because you subscribed. Unsubscribe',
    ].join('\n\n'),
  })
})

test('emailMarkdown - line breaks keep their lines without trailing spaces', () => {
  assert({
    given: 'paragraphs written as divs ending in line breaks, one with a break inside it',
    should: 'keep each line and paragraph without the hard-break spaces',
    actual: emailMarkdown({ bodyHtml: '<div>First line.<br>Same paragraph.<br><br></div><div>Second.<br><br></div>' }),
    expected: 'First line.\nSame paragraph.\n\nSecond.',
  })
})

test('emailMarkdown - an email with no HTML part keeps its plain text', () => {
  assert({
    given: 'only a text/plain body',
    should: 'return that text',
    actual: emailMarkdown({ bodyText: '  Atlas notes, plain.\n' }),
    expected: 'Atlas notes, plain.',
  })
})

const content = [
  'View in browser',
  '# The Atlas Field Guide',
  'Most maps are wrong in 2026. That’s the **point** of a field guide.',
  '- Walk first\n- Draw second',
  'See you next week.',
  'You received this because you subscribed. Unsubscribe',
].join('\n\n')

test('keepBetween - quotes from the plain text cut away the header and footer', () => {
  assert({
    given: 'start and end quotes with straight quotes and no bold markers',
    should: 'keep the paragraphs from the start quote through the end quote',
    actual: keepBetween(content, { start: "most maps are wrong in 2026. That's the point", end: 'See you next week' }),
    expected: {
      text: [
        'Most maps are wrong in 2026. That’s the **point** of a field guide.',
        '- Walk first\n- Draw second',
        'See you next week.',
      ].join('\n\n'),
    },
  })
})

test('keepBetween - no quotes keeps everything', () => {
  assert({
    given: 'neither quote',
    should: 'return the whole content',
    actual: keepBetween(content, {}),
    expected: { text: content },
  })
})

test('keepBetween - quotes match whole words only', () => {
  assert({
    given: 'an end quote that is only the start of a longer word in the content',
    should: 'report the end quote missing rather than cut inside the word',
    actual: keepBetween(content, { start: 'Most maps', end: 'next wee' }),
    expected: { missing: 'end' },
  })
})

test('keepBetween - quotes not in the content are reported, in order', () => {
  assert({
    given: 'a start quote that is not in the content',
    should: 'report the start quote missing',
    actual: keepBetween(content, { start: 'Widget-V2 launch' }),
    expected: { missing: 'start' },
  })

  assert({
    given: 'an end quote that only appears before the start quote',
    should: 'report the end quote missing',
    actual: keepBetween(content, { start: 'See you next week', end: 'Walk first' }),
    expected: { missing: 'end' },
  })
})
