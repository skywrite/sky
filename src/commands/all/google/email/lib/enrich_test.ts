import { assert, test } from '#test'
import { buildEmailTranscript } from './enrich.ts'

test('buildEmailTranscript leads with the subject', () => {
  assert({
    given: 'a subject and one message',
    should: 'state the subject before the sender-labeled body',
    actual: buildEmailTranscript('Atlas kickoff', [{ from: 'Jane Doe', markdown: 'Can we meet Thursday?' }]),
    expected: 'Subject: Atlas kickoff\n\nJane Doe: Can we meet Thursday?',
  })
})

test('buildEmailTranscript labels each message with its sender', () => {
  assert({
    given: 'a thread of replies',
    should: 'keep them in order, one block each',
    actual: buildEmailTranscript('Atlas kickoff', [
      { from: 'Jane Doe', markdown: 'Can we meet Thursday?' },
      { from: 'John Smith', markdown: 'Thursday works.' },
    ]),
    expected: 'Subject: Atlas kickoff\n\nJane Doe: Can we meet Thursday?\n\nJohn Smith: Thursday works.',
  })
})

test('buildEmailTranscript skips messages that converted to nothing', () => {
  assert({
    given: 'an empty message among real ones',
    should: 'omit it rather than label an empty block',
    actual: buildEmailTranscript('Atlas kickoff', [
      { from: 'Jane Doe', markdown: '   ' },
      { from: 'John Smith', markdown: 'Thursday works.' },
    ]),
    expected: 'Subject: Atlas kickoff\n\nJohn Smith: Thursday works.',
  })
})

test('buildEmailTranscript returns nothing when no message has text', () => {
  assert({
    given: 'a thread whose every message converted to nothing',
    should: 'return empty so the caller skips enrichment rather than summarizing a subject alone',
    actual: buildEmailTranscript('Atlas kickoff', [{ from: 'Jane Doe', markdown: '' }]),
    expected: '',
  })
})

test('buildEmailTranscript survives a missing subject', () => {
  assert({
    given: 'a thread with no subject line',
    should: 'transcribe the messages without a subject header',
    actual: buildEmailTranscript('', [{ from: 'Jane Doe', markdown: 'Can we meet Thursday?' }]),
    expected: 'Jane Doe: Can we meet Thursday?',
  })
})
