import { assert, test } from '#test'
import { approvalCard } from './approvalCard.ts'

const ESC = String.fromCharCode(27)

test({ name: 'approval card - a tool describes its own call; color codes do not reach the page' }, () => {
  const lines = approvalCard('slack_post', { channel: 'general', text: 'Hello' }, (input, output) => {
    output.log('')
    output.log(`${ESC}[1mPost to #${input.channel}${ESC}[0m`)
    output.log(String(input.text))
    output.log('')
  })
  assert({
    given: 'a formatter that writes a bold heading between blank lines',
    should: 'keep its lines, plain, without the blank edges',
    actual: lines,
    expected: ['Post to #general', 'Hello'],
  })
})

test({ name: 'approval card - without a formatter the fields are listed, a long value on its own lines' }, () => {
  assert({
    given: 'a call with a one-line and a multi-line field',
    should: 'list each field, the multi-line one under its key',
    actual: approvalCard('notes_create', { title: 'Atlas', body: 'line one\nline two', tags: ['a', 'b'] }),
    expected: ['title: Atlas', 'body:', 'line one\nline two', 'tags: ["a","b"]'],
  })
})

test({ name: 'approval card - a call with nothing to show still names the tool' }, () => {
  assert({
    given: 'an empty input and no formatter',
    should: 'fall back to the tool name so the card is never blank',
    actual: approvalCard('day_items', undefined),
    expected: ['day_items'],
  })
})
