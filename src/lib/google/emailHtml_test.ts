import { assert, test } from '#test'
import { renderEmailHtml } from './emailHtml.ts'

test('renderEmailHtml', () => {
  const wrapped = [
    'Hi Jane,',
    '',
    'Attached is the Atlas kickoff agenda. The first section lists the three',
    'decisions the team needs before Thursday; the rest is background.',
    '',
    'Thanks!',
  ].join('\n')

  assert({
    given: 'a body hard-wrapped at 72 columns',
    should: 'render one paragraph per blank-line block with no <br> at the wrap points',
    expected: [
      '<p>Hi Jane,</p>',
      '<p>Attached is the Atlas kickoff agenda. The first section lists the three\ndecisions the team needs before Thursday; the rest is background.</p>',
      '<p>Thanks!</p>',
    ].join('\n'),
    actual: renderEmailHtml(wrapped),
  })
})

test('renderEmailHtml markdown', () => {
  assert({
    given: 'a bare URL, a list, emphasis, and a literal angle bracket',
    should: 'link the URL, render the list and emphasis, and escape the bracket',
    expected: [
      '<p>Doc: <a href="https://example.com/doc">https://example.com/doc</a></p>',
      '<ul>',
      '<li>first</li>',
      '<li><strong>second</strong></li>',
      '</ul>',
      '<p>a &lt; b</p>',
    ].join('\n'),
    actual: renderEmailHtml('Doc: https://example.com/doc\n\n- first\n- **second**\n\na < b\n'),
  })
})
