import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import {
  collapseAdjacentDuplicates,
  nameTheOwner,
  renameSenders,
  renderDialogue,
  senderSummary,
} from './extractFromImage.ts'
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

test('nameTheOwner', async (t) => {
  const extraction = { from: 'Sarah', to: 'Me', messages: [msg('Sarah', 'hi'), msg('Me', 'hey'), msg('you', 'ok')] }

  await t.step('files the owner by name wherever the model wrote a label', () => {
    const named = nameTheOwner(extraction, 'Jane Doe')
    assert({
      given: 'a to and senders the model labelled "Me" and "you"',
      should: 'name the owner and leave the other party alone',
      actual: [named.from, named.to, named.messages.map((m) => m.sender)],
      expected: ['Sarah', 'Jane Doe', ['Sarah', 'Jane Doe', 'Jane Doe']],
    })
  })

  await t.step('changes nothing without a name', () => {
    assert({
      given: 'no owner name, or a blank one',
      should: 'return the extraction as it was',
      actual: [nameTheOwner(extraction, undefined), nameTheOwner(extraction, '  ')],
      expected: [extraction, extraction],
    })
  })

  await t.step('leaves a name that merely starts with the label', () => {
    const mel = { from: 'Mel', to: null, messages: [msg('Mel', 'hi')] }
    assert({
      given: 'a sender called Mel',
      should: 'keep it',
      actual: nameTheOwner(mel, 'Jane Doe'),
      expected: mel,
    })
  })
})

test('extract-from-image.prompt.md', async (t) => {
  const content = await readPromptFile(new URL('../prompts/extract-from-image.prompt.md', import.meta.url).pathname)
  // An explicit me namespace stops the render from reading the real AboutMe profile.
  const render = (me: Record<string, string>) =>
    renderPromptFile(content, 'extract-from-image.prompt.md', { me, user: { now: '2026-01-27 09:30' } })

  await t.step('names the owner from the profile', () => {
    const { output, warnings } = render({ fullName: 'Jane Doe' })
    assert({
      given: 'a profile with a name',
      should: 'give the outgoing side that name, with no "Me" left',
      actual: {
        warnings,
        outgoing: output.includes('who took the screenshot: Jane Doe.'),
        asTo: output.includes('the owner (Jane Doe) is `to`'),
        me: output.includes('"Me"'),
        unfilled: output.includes('{{'),
      },
      expected: { warnings: [], outgoing: true, asTo: true, me: false, unfilled: false },
    })
  })

  await t.step('falls back to "Me" without a name', () => {
    const { output, warnings } = render({})
    assert({
      given: 'no name in the profile',
      should: 'keep the "Me" wording and no stray name',
      actual: {
        warnings,
        outgoing: output.includes('otherwise call them "Me".'),
        asTo: output.includes('the owner ("Me") is `to`'),
        name: output.includes('Jane Doe'),
        unfilled: output.includes('{{'),
      },
      expected: { warnings: [], outgoing: true, asTo: true, name: false, unfilled: false },
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

test('renderDialogue', async (t) => {
  await t.step('formats untimed messages as markdown', () => {
    assert({
      given: 'a list of messages with no timestamps',
      should: 'render "**Name:** text" paragraphs',
      actual: renderDialogue([msg('Alice', 'See you at 8'), msg('Bob', 'sounds good')]),
      expected: '**Alice:** See you at 8\n\n**Bob:** sounds good',
    })
  })

  await t.step('appends a timestamp where the screenshot showed one', () => {
    assert({
      given: 'messages carrying times',
      should: 'render the time in parentheses after the name',
      actual: renderDialogue([msg('Alice', 'See you at 8', '16:18'), msg('Bob', 'sounds good', '16:22')]),
      expected: '**Alice:** (16:18) See you at 8\n\n**Bob:** (16:22) sounds good',
    })
  })

  await t.step('omits the timestamp only for the messages missing one', () => {
    assert({
      given: 'a stamped message followed by an unstamped one',
      should: 'stamp the first and leave the second bare',
      actual: renderDialogue([msg('Alice', 'See you at 8', '16:18'), msg('Alice', 'bring the map')]),
      expected: '**Alice:** (16:18) See you at 8\n\n**Alice:** bring the map',
    })
  })

  await t.step('keeps a cross-day stamp intact', () => {
    assert({
      given: 'a message on a different day than the conversation',
      should: 'render the full date-time it was given',
      actual: renderDialogue([msg('Bob', 'morning', '2026-01-21 09:15')]),
      expected: '**Bob:** (2026-01-21 09:15) morning',
    })
  })
})
