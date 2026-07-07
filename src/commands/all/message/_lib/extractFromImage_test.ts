import { assert, test } from '#test'
import { collapseAdjacentDuplicates, renameSenders, renderDialogue, senderSummary } from './extractFromImage.ts'
import type { ExtractedMessage } from './extractFromImage.ts'

function msg(sender: string, text: string, time: string | null = null): ExtractedMessage {
  return { sender, text, time }
}

test('collapseAdjacentDuplicates', async (t) => {
  await t.step('drops an adjacent repeat of the same message', () => {
    assert({
      given: 'the same sender/text twice in a row (overlap merge miss)',
      should: 'keep only one',
      actual: collapseAdjacentDuplicates([msg('Alice', 'See you at 8'), msg('Alice', 'See you at 8')]),
      expected: [msg('Alice', 'See you at 8')],
    })
  })

  await t.step('normalizes whitespace when comparing', () => {
    assert({
      given: 'repeats differing only in whitespace',
      should: 'treat them as duplicates and keep the first',
      actual: collapseAdjacentDuplicates([msg('Alice', 'See you  at 8'), msg('Alice', ' See you at 8 ')]),
      expected: [msg('Alice', 'See you  at 8')],
    })
  })

  await t.step('keeps the same text from different senders', () => {
    assert({
      given: 'two senders saying the same thing',
      should: 'keep both',
      actual: collapseAdjacentDuplicates([msg('Alice', 'ok'), msg('Bob', 'ok')]).length,
      expected: 2,
    })
  })

  await t.step('keeps non-adjacent repeats', () => {
    assert({
      given: 'the same message repeated later in the conversation',
      should: 'keep both occurrences',
      actual: collapseAdjacentDuplicates([msg('Alice', 'ok'), msg('Bob', 'sure?'), msg('Alice', 'ok')]).length,
      expected: 3,
    })
  })

  await t.step('keeps adjacent repeats with two different timestamps', () => {
    assert({
      given: 'a genuine double-send with distinct visible times',
      should: 'keep both',
      actual: collapseAdjacentDuplicates([msg('Alice', 'hello?', '14:02'), msg('Alice', 'hello?', '14:10')]).length,
      expected: 2,
    })
  })

  await t.step('drops an adjacent repeat when only one has a timestamp', () => {
    assert({
      given: 'a repeat where the time was visible in just one screenshot',
      should: 'treat it as a duplicate',
      actual: collapseAdjacentDuplicates([msg('Alice', 'hello?', '14:02'), msg('Alice', 'hello?')]).length,
      expected: 1,
    })
  })
})

test('renameSenders', async (t) => {
  await t.step('renames matching senders and leaves others untouched', () => {
    assert({
      given: 'a rename of "Me" to "Alex"',
      should: 'rename only the matching messages',
      actual: renameSenders(
        [msg('Sarah', 'hi'), msg('Me', 'hey'), msg('Me', 'how are you?')],
        [{ from: 'Me', to: 'Alex' }],
      ).map((m) => m.sender),
      expected: ['Sarah', 'Alex', 'Alex'],
    })
  })

  await t.step('applies multiple renames in one pass', () => {
    assert({
      given: 'two renames',
      should: 'apply both',
      actual: renameSenders(
        [msg('Me', 'hi'), msg('Sarah', 'hey')],
        [
          { from: 'Me', to: 'Alex' },
          { from: 'Sarah', to: 'Sarah Kim' },
        ],
      ).map((m) => m.sender),
      expected: ['Alex', 'Sarah Kim'],
    })
  })

  await t.step('returns messages unchanged for an empty rename list', () => {
    const messages = [msg('Sarah', 'hi')]
    assert({
      given: 'no renames',
      should: 'return equivalent messages',
      actual: renameSenders(messages, []),
      expected: messages,
    })
  })
})

test('senderSummary lists distinct senders with counts in first-appearance order', () => {
  assert({
    given: 'messages from two senders',
    should: 'summarize as "Name ×count" pairs',
    actual: senderSummary([msg('Sarah', 'a'), msg('Me', 'b'), msg('Sarah', 'c'), msg('Sarah', 'd')]),
    expected: 'Sarah ×3, Me ×1',
  })
})

test('renderDialogue formats messages as markdown', () => {
  assert({
    given: 'a list of messages',
    should: 'render "**Name:** text" paragraphs',
    actual: renderDialogue([msg('Alice', 'See you at 8'), msg('Bob', 'sounds good')]),
    expected: '**Alice:** See you at 8\n\n**Bob:** sounds good',
  })
})
