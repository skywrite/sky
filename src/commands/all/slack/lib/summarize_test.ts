import { assert, test } from '#test'
import { buildTranscript, cleanSummary, fallbackSummary } from './summarize.ts'

// --- buildTranscript ---

test('buildTranscript: root message only', () => {
  assert({
    given: 'a root message with no replies',
    should: 'return a single speaker-labeled line',
    actual: buildTranscript({ text: 'Launch is delayed to August', userName: 'Joe' }),
    expected: 'Joe: Launch is delayed to August',
  })
})

test('buildTranscript: header root with thread replies', () => {
  assert({
    given: 'a header-only root whose substance is in thread replies',
    should: 'include the replies in the transcript',
    actual: buildTranscript({ text: 'July 10th Integration Update (in 🧵)', userName: 'Joe' }, [
      { text: 'Atlas has not countersigned yet', userName: 'Joe' },
      { text: 'Legal review requested', userId: 'U123' },
    ]),
    expected:
      'Joe: July 10th Integration Update (in 🧵)\n\nJoe: Atlas has not countersigned yet\n\nU123: Legal review requested',
  })
})

test('buildTranscript: empty and whitespace messages skipped', () => {
  assert({
    given: 'an empty root with one whitespace and one real reply',
    should: 'keep only the real reply',
    actual: buildTranscript({ text: '' }, [{ text: '   ' }, { text: 'actual content', userName: 'Ana' }]),
    expected: 'Ana: actual content',
  })
})

test('buildTranscript: nothing to summarize', () => {
  assert({
    given: 'no message text anywhere',
    should: 'return an empty string',
    actual: buildTranscript({ text: '' }, [{ text: '' }]),
    expected: '',
  })
})

// --- cleanSummary ---

test('cleanSummary: valid summary', () => {
  assert({
    given: 'a short one-line summary',
    should: 'return it unchanged',
    actual: cleanSummary('Ledger card program integration update'),
    expected: 'Ledger card program integration update',
  })
})

test('cleanSummary: strips quotes and trailing period', () => {
  assert({
    given: 'a summary wrapped in quotes with a trailing period',
    should: 'strip both',
    actual: cleanSummary('"Atlas contract signing status update."'),
    expected: 'Atlas contract signing status update',
  })
})

test('cleanSummary: conversational refusal is rejected', () => {
  assert({
    given: 'the multi-line refusal a fast model produced for a header-only message',
    should: 'return undefined',
    actual: cleanSummary(
      "I don't see the actual Slack message content in your request. You've only provided the header \"July 10th Integration Update (in 🧵)\".\n\nCould you please share the full message you'd like me to summarize?",
    ),
    expected: undefined,
  })
})

test('cleanSummary: one-line over-length reply is rejected', () => {
  assert({
    given: 'a single-line conversational reply longer than a label',
    should: 'return undefined',
    actual: cleanSummary("I'd be happy to help but I don't see a Slack message included for me to summarize here"),
    expected: undefined,
  })
})

test('cleanSummary: question is rejected', () => {
  assert({
    given: 'a short reply that is a question',
    should: 'return undefined',
    actual: cleanSummary('Could you share the message?'),
    expected: undefined,
  })
})

test('cleanSummary: empty reply is rejected', () => {
  assert({
    given: 'whitespace-only model output',
    should: 'return undefined',
    actual: cleanSummary('  '),
    expected: undefined,
  })
})

// --- fallbackSummary ---

test('fallbackSummary: uses root message first line', () => {
  assert({
    given: 'a root message with a header line',
    should: 'return the first line truncated to 80 chars',
    actual: fallbackSummary({ text: 'July 10th Integration Update (in 🧵)\nmore below' }),
    expected: 'July 10th Integration Update (in 🧵)',
  })
})

test('fallbackSummary: falls through to first non-empty reply', () => {
  assert({
    given: 'an empty root message and a reply with text',
    should: 'use the reply text',
    actual: fallbackSummary({ text: '' }, [{ text: 'Atlas has not countersigned' }]),
    expected: 'Atlas has not countersigned',
  })
})

test('fallbackSummary: no text at all', () => {
  assert({
    given: 'no message text anywhere',
    should: 'return undefined',
    actual: fallbackSummary({ text: '' }, [{ text: ' ' }]),
    expected: undefined,
  })
})
