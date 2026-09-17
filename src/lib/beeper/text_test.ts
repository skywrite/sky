import { assert, test } from '#test'
import { beeperText, decodeEntities } from './text.ts'

test('beeper text - plain bodies pass through and Matrix HTML folds back into markdown', () => {
  assert({
    given: 'a plain message, a formatted one, a reply with its quoted fallback, and a list',
    should: 'keep plain text, turn tags into markdown, drop the quote, and keep the list lines',
    actual: [
      beeperText('Running late, order for me?\r\n'),
      beeperText(
        '<p>Hi <b>there</b></p><p>See <a href="https://example.com/x?a=1&amp;b=2">this</a><br>and &amp; that</p>',
      ),
      beeperText('<mx-reply><blockquote>Earlier words</blockquote></mx-reply>Yes, <em>tomorrow</em> works'),
      beeperText('<ul><li>milk</li><li>eggs &#39;n&#39; bread</li></ul>'),
      beeperText('<a href="https://example.com/">https://example.com/</a>'),
      beeperText(undefined),
    ],
    expected: [
      'Running late, order for me?',
      'Hi **there**\n\nSee [this](https://example.com/x?a=1&b=2)\nand & that',
      'Yes, _tomorrow_ works',
      "- milk\n- eggs 'n' bread",
      'https://example.com/',
      '',
    ],
  })
})

test('beeper text - entities decode by name and by number, and unknown ones stay put', () => {
  assert({
    given: 'named, decimal, hex and unknown entities',
    should: 'decode what it knows',
    actual: decodeEntities('&lt;3 &#8212; &#x1F600; &bogus; &nbsp;'),
    expected: '<3 — 😀 &bogus;  ',
  })
})
