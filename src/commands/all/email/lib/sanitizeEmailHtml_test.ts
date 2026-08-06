import { assert, test } from '#test'
import { sanitizeEmailHtml } from './sanitizeEmailHtml.ts'

// A synthetic Word/Outlook-style email: XML prolog, MSO conditionals, a fat
// <style> head, an inline style= on every element, deep span nesting, a data:
// URI image, a tracking pixel, and a Gmail quote/signature block. Mirrors the
// markup-to-text ratio of real corporate mail (most bytes are not content).
function buildFixture(): string {
  const paragraphs = Array.from(
    { length: 40 },
    (_, i) =>
      `<p class="MsoNormal" style="margin-bottom:12.0pt;line-height:115%;mso-margin-top-alt:auto">` +
      `<span style="font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif;color:#1F497D">` +
      `Paragraph ${i + 1}: the Atlas Corp integration plan continues with milestone ${i + 1}.` +
      `</span><o:p></o:p></p>`,
  ).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">',
    '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    '<title>Weekly Update</title>',
    `<style><!-- @font-face {font-family:"Cambria Math";} ${'p.MsoNormal {margin:0in;font-size:11.0pt;} '.repeat(60)}--></style>`,
    '</head>',
    '<body lang="EN-US" style="word-wrap:break-word">',
    '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->',
    '<![if !supportLists]>',
    '<div style="margin:0;padding:20px">',
    paragraphs,
    `<p class="MsoNormal">Read the <a href="https://tracking.example.com/click?id=${'x'.repeat(400)}&amp;dest=q3" target="_blank" style="color:#0563C1;text-decoration:underline"><b>quarterly report</b></a> before Friday.</p>`,
    '<img src="https://cdn.example.com/logo.png" alt="Atlas Corp logo" width="200" height="50" style="border:0">',
    '<img src="https://track.example.com/open?uid=12345" width="1" height="1">',
    `<img src="data:image/png;base64,${'A'.repeat(20000)}">`,
    '<p class="MsoNormal">Regards&nbsp;&nbsp;&nbsp;&nbsp;from&nbsp;the&nbsp;team</p>',
    '<div class="gmail_signature">Jane Doe · VP Operations · Atlas Corp</div>',
    '<div class="gmail_quote">',
    '<div dir="ltr" class="gmail_attr">On Mon, Jan 5, 2026 John Smith wrote:</div>',
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">',
    'Earlier reply about the milestone schedule.',
    '</blockquote></div>',
    '</div>',
    '</body></html>',
  ].join('\n')
}

test('sanitizeEmailHtml removes non-content machinery', () => {
  const out = sanitizeEmailHtml(buildFixture())

  for (const gone of [
    '<style',
    '<head',
    '<title',
    'DOCTYPE',
    '<?xml',
    '@font-face',
    '<meta',
    'OfficeDocumentSettings',
    'supportLists',
  ]) {
    assert({
      given: 'a Word/Outlook-style email',
      should: `drop ${gone}`,
      actual: out.includes(gone),
      expected: false,
    })
  }
})

test('sanitizeEmailHtml strips presentational attributes but keeps structural tags', () => {
  const out = sanitizeEmailHtml(buildFixture())

  assert({
    given: 'elements with inline styles',
    should: 'drop every style= attribute',
    actual: out.includes('style='),
    expected: false,
  })

  assert({
    given: 'a styled link',
    should: 'drop target= and width= noise',
    actual: out.includes('target=') || out.includes('width='),
    expected: false,
  })

  assert({
    given: 'paragraph and bold tags',
    should: 'keep them as bare tags',
    actual: out.includes('<p>') && out.includes('<b>'),
    expected: true,
  })

  assert({
    given: 'a presentational MsoNormal class',
    should: 'drop it',
    actual: out.includes('MsoNormal'),
    expected: false,
  })
})

test('sanitizeEmailHtml preserves semantic signals', () => {
  const out = sanitizeEmailHtml(buildFixture())

  assert({
    given: 'a long tracking link',
    should: 'keep the href',
    actual: out.includes('https://tracking.example.com/click?id='),
    expected: true,
  })

  for (const cls of ['gmail_quote', 'gmail_attr', 'gmail_signature']) {
    assert({
      given: 'Gmail semantic classes',
      should: `keep class ${cls}`,
      actual: out.includes(`class="${cls}"`),
      expected: true,
    })
  }

  assert({
    given: 'a quoted reply',
    should: 'keep the blockquote tag',
    actual: out.includes('<blockquote'),
    expected: true,
  })
})

test('sanitizeEmailHtml reduces images to their alt text', () => {
  const out = sanitizeEmailHtml(buildFixture())

  assert({
    given: 'a real image with alt text',
    should: 'keep only the alt',
    actual: out.includes('<img alt="Atlas Corp logo">'),
    expected: true,
  })

  assert({
    given: 'image srcs, tracking pixels, and data: URIs',
    should: 'drop them all',
    actual:
      out.includes('cdn.example.com') ||
      out.includes('track.example.com') ||
      out.includes('data:image') ||
      out.includes('AAAAA'),
    expected: false,
  })
})

test('sanitizeEmailHtml preserves the message text', () => {
  const out = sanitizeEmailHtml(buildFixture())

  for (const sentence of [
    'Paragraph 1: the Atlas Corp integration plan continues with milestone 1.',
    'Paragraph 40: the Atlas Corp integration plan continues with milestone 40.',
    'quarterly report',
    'Jane Doe · VP Operations · Atlas Corp',
    'On Mon, Jan 5, 2026 John Smith wrote:',
    'Earlier reply about the milestone schedule.',
  ]) {
    assert({
      given: 'the sanitized email',
      should: `still contain "${sentence.slice(0, 40)}..."`,
      actual: out.includes(sentence),
      expected: true,
    })
  }

  assert({
    given: 'text wrapped in spans and o:p tags',
    should: 'unwrap it rather than delete it',
    actual: out.includes('<span') || out.includes('<o:p>'),
    expected: false,
  })
})

test('sanitizeEmailHtml collapses whitespace bloat', () => {
  const out = sanitizeEmailHtml(buildFixture())

  assert({
    given: '&nbsp; runs',
    should: 'collapse them to single spaces',
    actual: out.includes('Regards from the team'),
    expected: true,
  })

  assert({
    given: 'blank-line runs from removed blocks',
    should: 'collapse to at most one blank line',
    actual: out.includes('\n\n\n'),
    expected: false,
  })
})

test('sanitizeEmailHtml achieves a major size reduction', () => {
  const input = buildFixture()
  const out = sanitizeEmailHtml(input)

  assert({
    given: `a ${input.length}-char corporate email`,
    should: 'shrink to less than a fifth of the input',
    actual: out.length < input.length / 5,
    expected: true,
  })
})

test('sanitizeEmailHtml passes tag-free text through intact', () => {
  const plain = 'Hello team,\n\nThe plan is on track.\n\nJane'

  assert({
    given: 'plain text with no markup',
    should: 'return it unchanged',
    actual: sanitizeEmailHtml(plain),
    expected: plain,
  })
})
