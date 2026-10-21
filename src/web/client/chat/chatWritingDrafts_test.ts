import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { assert, test } from '#test'
import { escapeHtml } from '../editor/wysiwyg/html.ts'
import { splitWritingDrafts, writingDraftDiffHtml, writingDraftReplies } from './chatWritingDrafts.ts'

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

test('draft frames recognize the same writing after Markdown presentation changes', () => {
  const original = 'Atlas update\n============\n\nPlease review **the plan** by Friday.'
  const revised = 'Atlas update\n============\n\nPlease review **the plan** by Monday.'
  const record = { ...draft, versions: [{ text: original }, { text: revised }] } as WritingDraftView
  for (const text of [original, revised]) {
    const displayed = text
      .replace('Atlas update\n============', '**Atlas update**')
      .replace('**the plan**', '__the plan__')
    const parts = splitWritingDrafts(
      `Here is the draft.\n\n> ${displayed.replaceAll('\n', '\n> ')}\n\nCheck before sending.`,
      [record],
    )
    assert({
      given: 'a saved draft with an underlined subject displayed as bold Markdown in a reply',
      should: 'link each appearance to the same editable record and retain its displayed wording',
      actual: parts?.filter((part) => 'draftId' in part),
      expected: [{ draftId: record.id, text: displayed }],
    })
  }
  for (const text of [
    revised.replace('Monday', 'Tuesday'),
    `${revised}\n\nAnother message.`,
    'Atlas update\n============',
    'Atlas update\n============\n\nPlease review **the plan** by [Monday](https://example.com/different).',
  ]) {
    assert({
      given: 'a quote with different wording, extra commentary, an excerpt, or a different link',
      should: 'remain ordinary quoted text',
      actual: splitWritingDrafts(`> ${text.replaceAll('\n', '\n> ')}`, [record]),
      expected: null,
    })
  }
})

test('a plain subject line presented as bold, italic or a heading still frames the draft', () => {
  const saved = 'Atlas update\n\nPlease review **the plan** by Friday.\n\nThanks.'
  const record = { ...draft, versions: [{ text: saved }] } as WritingDraftView
  for (const subject of ['**Atlas update**', '*Atlas update*', '# Atlas update']) {
    const displayed = saved.replace('Atlas update', subject)
    assert({
      given: `Ghostwriter's plain subject line quoted as ${subject}`,
      should: 'link the quote to the editable record and retain its displayed wording',
      actual: splitWritingDrafts(`Here is the draft.\n\n> ${displayed.replaceAll('\n', '\n> ')}`, [record])?.filter(
        (part) => 'draftId' in part,
      ),
      expected: [{ draftId: record.id, text: displayed }],
    })
  }
  for (const text of [
    saved.replace('Atlas update', '**Atlas update**').replace('Friday', 'Monday'),
    saved.replace('Atlas update', '**Atlas** update'),
  ]) {
    assert({
      given: 'a bold subject over different wording, or a subject only partly bold',
      should: 'remain ordinary quoted text',
      actual: splitWritingDrafts(`> ${text.replaceAll('\n', '\n> ')}`, [record]),
      expected: null,
    })
  }
})

test('the editor sits on the latest reply that shows the draft or changed it', () => {
  const warmer = 'Hi Jane,\n\nI would appreciate your review of **Atlas** by Friday.\n\nThanks.'
  const record = { ...draft, turn: 1, versions: [{ text }, { text: warmer }] } as WritingDraftView
  const quoted = (words: string) => `Here is the message.\n\n> ${words.replaceAll('\n', '\n> ')}`
  const turns = [
    { role: 'user', content: 'Draft a note to Jane.' },
    { role: 'assistant', content: quoted(text) },
    { role: 'user', content: 'Make it warmer.' },
    { role: 'assistant', content: 'Done. It reads warmer now.' },
    { role: 'user', content: 'Who else should see it?' },
    { role: 'assistant', content: 'Only Jane.' },
  ] as const
  const writer = (at: number, draftId: string, status: 'success' | 'error' = 'success') => ({
    tool: 'me_voice',
    at,
    status,
    output: { success: status === 'success', draftId },
  })
  const runs = [writer(1, 'f'.repeat(32)), writer(3, record.id)]
  assert({
    given: 'a revision whose reply does not quote the draft, then an unrelated reply',
    should: 'move the editor to the reply that revised it and keep it there',
    actual: writingDraftReplies([record], turns, runs, false).get(record.id),
    expected: 3,
  })
  assert({
    given: 'a later reply that quotes the current draft without revising it',
    should: 'move the editor to that reply',
    actual: writingDraftReplies(
      [record],
      [...turns.slice(0, 5), { role: 'assistant', content: quoted(warmer) }],
      runs,
      false,
    ).get(record.id),
    expected: 5,
  })
  assert({
    given: 'a revision in the reply still being written, and a failed one',
    should: 'leave the editor where it was until the reply finishes',
    actual: [
      writingDraftReplies([record], turns, [...runs, writer(5, record.id)], true).get(record.id),
      writingDraftReplies([record], turns, [...runs, writer(5, record.id, 'error')], false).get(record.id),
      writingDraftReplies([record], turns, [...runs, writer(5, record.id)], false).get(record.id),
    ],
    expected: [3, 3, 5],
  })
})

test('legacy Slack draft rendering also finds the saved draft without treating code as editable', () => {
  const text = '**Atlas update**\n\nPlease review [the plan](https://example.com/plan).'
  const slack = '*Atlas update*\n*============*\n\nPlease review <https://example.com/plan|the plan>.'
  for (const saved of [text, slack]) {
    const record = { ...draft, versions: [{ text: saved }] } as WritingDraftView
    for (const reply of [
      `\`\`\`slack\n${slack}\n\`\`\``,
      `> \`\`\`text\n> ${slack.replaceAll('\n', '\n> ')}\n> \`\`\``,
    ]) {
      assert({
        given: 'a legacy Slack fence already rendered as a readable review quote',
        should: 'render the saved draft in that same position with either Slack or Markdown stored wording',
        actual: splitWritingDrafts(reply, [record]),
        expected: [{ draftId: record.id, text }],
      })
    }
    assert({
      given: 'the same draft in a Markdown source code fence',
      should: 'keep the code sample read-only',
      actual: splitWritingDrafts(`\`\`\`markdown\n${text}\n\`\`\``, [record]),
      expected: null,
    })
  }
})

test('formatting matches cannot choose between distinct drafts with the same wording', () => {
  const record = { ...draft, versions: [{ text: 'Atlas update\n============\n\nReady.' }] } as WritingDraftView
  const other = { ...record, id: 'b'.repeat(32) }
  assert({
    given: 'two saved drafts that both match the formatted quote',
    should: 'leave the quote alone instead of editing an arbitrary record',
    actual: splitWritingDrafts('> **Atlas update**\n>\n> Ready.', [record, other]),
    expected: null,
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
