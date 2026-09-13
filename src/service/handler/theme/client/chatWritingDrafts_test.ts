import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { assert, test } from '#test'
import { splitWritingDrafts, writingDraftDiffHtml } from './chatWritingDrafts.ts'
import { escapeHtml } from './wysiwyg/html.ts'

const text = 'Hi Jane,\n\nPlease review **Atlas** by Friday.\n\nThanks.'
const draft = {
  id: 'a'.repeat(32),
  versions: [{ text }, { text: 'Please review Atlas by Friday.' }],
} as WritingDraftView

test('framed drafts replace only matching top-level writer quotes and preserve surrounding commentary', () => {
  const reply = `Here is the message.\n\n> ${text.replaceAll('\n', '\n> ')}\n\nCheck the timing before sending.\n\n> A quote from someone else.`
  const parts = splitWritingDrafts(reply, [draft])!
  assert({
    given: 'a draft inside advice and an unrelated quote',
    should: 'identify only the draft and keep both surrounding sections readable',
    actual: [
      parts.length,
      parts[1],
      'html' in parts[0]! && parts[0].html.includes('Here is the message.'),
      'html' in parts[2]! && parts[2].html.includes('Check the timing before sending.'),
      'html' in parts[2]! && parts[2].html.includes('<blockquote>'),
    ],
    expected: [3, { draftId: draft.id, text }, true, true, true],
  })
  assert({
    given: 'the same text inside code or in an unrelated message',
    should: 'leave it unchanged without identifying it as a draft',
    actual: [
      splitWritingDrafts(`\`\`\`markdown\n> ${text.replaceAll('\n', '\n> ')}\n\`\`\``, [draft]),
      splitWritingDrafts('> A quote from someone else.', [draft]),
    ],
    expected: [null, null],
  })
})

test('draft comparisons show what restoring a selected version would remove and add', () => {
  assert({
    given: 'the current draft says Monday and the selected version says Friday',
    should: 'mark Monday for removal and Friday for addition, preserving paragraphs',
    actual: writingDraftDiffHtml('Review on Monday.\n\nThanks.', 'Review on Friday.\n\nThanks.'),
    expected: 'Review on <del>Monday</del><ins>Friday</ins>.\n\nThanks.',
  })
  assert({
    given: 'a whole phrase is replaced with two words',
    should: 'keep each reading together rather than alternating words around unchanged spaces',
    actual: writingDraftDiffHtml('Review with the launch team.', 'Review by Friday.'),
    expected: 'Review <del>with the launch team</del><ins>by Friday</ins>.',
  })
  assert({
    given: 'identical text that includes markup',
    should: 'leave it unchanged as escaped text without change markers',
    actual: writingDraftDiffHtml('<Jane> & **Atlas**', '<Jane> & **Atlas**'),
    expected: '&lt;Jane&gt; &amp; **Atlas**',
  })
})

test('draft comparisons retain exact text and safely display markup, spacing and large rewrites', () => {
  const pairs = [
    ['Hi Jane,\n\nThanks.', 'Hi  Jane,\n\n\nThank you.'],
    ['Review **Atlas**.', 'Review <img src=x onerror=alert(1)> & _Atlas_.'],
    ['Thanks 👋', '谢谢 👋'],
    ['Monday '.repeat(4000), 'Friday '.repeat(4000)],
  ]
  for (const [current, selected] of pairs) {
    const html = writingDraftDiffHtml(current!, selected!)
    assert({
      given: 'any pair of draft texts, including a wholesale rewrite',
      should: 'recover either exact text by excluding its opposite change marks, with HTML kept inert',
      actual: [
        html.replaceAll(/<ins>[\s\S]*?<\/ins>/g, '').replaceAll(/<\/?del>/g, ''),
        html.replaceAll(/<del>[\s\S]*?<\/del>/g, '').replaceAll(/<\/?ins>/g, ''),
      ],
      expected: [escapeHtml(current!), escapeHtml(selected!)],
    })
  }
})
