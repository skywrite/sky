import { assert, test } from '#test'
import { applyParticipantCorrections, extractTypedParticipants } from './applyCorrections.ts'
import type { ExtractedMessage } from './extractFromImage.ts'

function msg(sender: string, text: string): ExtractedMessage {
  return { sender, text, time: null }
}

test('extractTypedParticipants', async (t) => {
  await t.step('reads labelled from and to regardless of key case', () => {
    assert({
      given: 'a correction like "From: Jane Doe, to: Atlas"',
      should: 'capture both values verbatim',
      actual: extractTypedParticipants('From: Jane Doe, to: Atlas'),
      expected: { from: 'Jane Doe', to: 'Atlas' },
    })
  })

  await t.step('reads a lone field among other corrections', () => {
    assert({
      given: 'a from: mixed with a medium correction',
      should: 'capture only the labelled participant',
      actual: extractTypedParticipants('medium: Signal, from: Atlas'),
      expected: { from: 'Atlas' },
    })
  })

  await t.step('ignores rename phrasing and times', () => {
    assert({
      given: 'corrections with no labelled from/to',
      should: 'return nothing',
      actual: extractTypedParticipants('Me is Alex, when: 14:30'),
      expected: {},
    })
  })

  await t.step('ignores from:/to: inside another segment', () => {
    assert({
      given: 'a summary correction containing "from:" mid-sentence',
      should: 'not mistake it for a field correction',
      actual: extractTypedParticipants('summary: figures from: the audit'),
      expected: {},
    })
  })

  await t.step('skips an empty value', () => {
    assert({
      given: 'a from: with no value ahead of a valid to:',
      should: 'capture only the usable field',
      actual: extractTypedParticipants('from: , to: Sam'),
      expected: { to: 'Sam' },
    })
  })
})

test('applyParticipantCorrections', async (t) => {
  const conversation = [msg('Jane Doe', 'We owe the vendor.'), msg('Me', 'How much?'), msg('Jane Doe', 'Checking.')]

  await t.step('typed from/to reassign the fields without touching senders', () => {
    assert({
      given: 'a reversed direction fixed via typed from:/to:',
      should: 'set both fields verbatim and leave every message label alone',
      actual: applyParticipantCorrections(
        { from: 'Me', to: 'Jane Doe', messages: conversation },
        { from: 'Jane Doe', to: 'Atlas' },
        { from: 'Jane Doe', to: 'Atlas' },
      ),
      expected: { from: 'Jane Doe', to: 'Atlas', messages: conversation },
    })
  })

  await t.step('typed values win over the model parse', () => {
    assert({
      given: 'a model that read the from correction differently',
      should: 'keep the typed value',
      actual: applyParticipantCorrections(
        { from: 'Me', to: 'Jane Doe', messages: [] },
        { from: 'Jane Doe' },
        { from: 'Janet Dough' },
      ).from,
      expected: 'Jane Doe',
    })
  })

  await t.step('model field corrections apply when nothing was typed', () => {
    assert({
      given: 'a freeform correction the model parsed into a from field',
      should: 'update the field and leave senders alone',
      actual: applyParticipantCorrections(
        { from: 'Me', to: 'Jane Doe', messages: conversation },
        {},
        { from: 'Atlas' },
      ),
      expected: { from: 'Atlas', to: 'Jane Doe', messages: conversation },
    })
  })

  await t.step('an explicit rename relabels messages and follows into uncorrected fields', () => {
    assert({
      given: '"Me is Atlas" with from currently Me',
      should: 'rename the dialogue sender and update from to match',
      actual: applyParticipantCorrections(
        { from: 'Me', to: 'Jane Doe', messages: [msg('Me', 'hi'), msg('Jane Doe', 'hey')] },
        {},
        { senderRenames: [{ from: 'Me', to: 'Atlas' }] },
      ),
      expected: { from: 'Atlas', to: 'Jane Doe', messages: [msg('Atlas', 'hi'), msg('Jane Doe', 'hey')] },
    })
  })

  await t.step('a rename never overwrites an explicitly corrected field', () => {
    assert({
      given: 'a typed from: whose value is also an old rename name',
      should: 'keep the typed field, rename the dialogue, and sync only the uncorrected to',
      actual: applyParticipantCorrections(
        { from: 'Me', to: 'Jane Doe', messages: [msg('Jane Doe', 'hey')] },
        { from: 'Jane Doe' },
        { from: 'Jane Doe', senderRenames: [{ from: 'Jane Doe', to: 'Sam' }] },
      ),
      expected: { from: 'Jane Doe', to: 'Sam', messages: [msg('Sam', 'hey')] },
    })
  })

  await t.step('a null field correction clears the field', () => {
    assert({
      given: 'the model reporting from changed to null',
      should: 'leave the field unset',
      actual: applyParticipantCorrections({ from: 'Me', to: 'Jane Doe', messages: [] }, {}, { from: null }).from,
      expected: undefined,
    })
  })
})
