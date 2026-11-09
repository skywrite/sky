import { assert, test } from '#test'
import { completeVideoBody, videoContent } from './content.ts'

const WORDS = 'Jane Doe explains the Atlas workflow and its next steps.'
const WRITEUP = '## Summary\n\nThe Atlas workflow has a clear review and approval process.'

test('a missing summary replaces its template above the existing transcript without changing notes', () => {
  const notes = '# Loom\n\n## Notes\n\nKeep this original reminder exactly.\n\n'
  const transcript = `## Transcript\n\n${WORDS}\n\n## Follow-up\n\nPreserve this later note too.\n`
  const body = `${notes}## Summary\n\n(insert summary here)\n\n${transcript}`
  const filled = completeVideoBody(body, { body: WRITEUP })
  assert({
    given: 'a summary placeholder before a full transcript and additional authored notes',
    should: 'put the write-up in the placeholder position and keep the other sections verbatim',
    actual: filled,
    expected: `${notes}## Imported summary\n\n### Summary\n\nThe Atlas workflow has a clear review and approval process.\n\n${transcript}`,
  })
  assert({
    given: 'the completed entry imported again',
    should: 'keep exactly the same summary, transcript and notes',
    actual: completeVideoBody(filled, { body: WRITEUP, cleanedText: WORDS }),
    expected: filled,
  })
})

test('summary insertion ignores transcript headings inside fenced code and preserves CRLF text', () => {
  const notes = '# Loom\r\n\r\n```md\r\n## Transcript\r\nExample, not the recording.\r\n```\r\n\r\n'
  const transcript = `## Transcript\r\n\r\n${WORDS}\r\n`
  const filled = completeVideoBody(notes + transcript, { body: WRITEUP })
  assert({
    given: 'a fenced transcript example followed by the actual transcript',
    should: 'insert only before the actual transcript and preserve all original bytes around it',
    actual: {
      notes: filled.startsWith(notes),
      transcript: filled.endsWith(transcript),
      ordering: filled.indexOf('## Imported summary') < filled.lastIndexOf('## Transcript'),
      words: videoContent(filled).transcriptText,
    },
    expected: { notes: true, transcript: true, ordering: true, words: WORDS },
  })
})

test('short authored summary notes are not discarded as placeholders', () => {
  const notes = '# Loom\n\n## Summary\n\nAsk Jane.\n\n'
  const filled = completeVideoBody(`${notes}## Transcript\n\n${WORDS}\n`, { body: WRITEUP })
  assert({
    given: 'a two-word human note that is too short to establish a completed summary',
    should: 'keep the note and insert a separate write-up above the transcript',
    actual: {
      original: filled.startsWith(notes),
      ordering: filled.indexOf('## Imported summary') < filled.indexOf('## Transcript'),
      words: videoContent(filled).transcriptText,
    },
    expected: { original: true, ordering: true, words: WORDS },
  })
})

test('transcript commentary cannot be mistaken for the recording when completing a summary', () => {
  const notes = '# Loom\n\n## Transcript Note\n\nThe recording ends before the discussion finishes.\n\n'
  const body = `${notes}## Transcript\n\n${WORDS}\n`
  const filled = completeVideoBody(body, { body: WRITEUP })
  assert({
    given: 'a Transcript Note section before the actual Transcript section',
    should: 'read the actual words and leave the commentary above the inserted summary',
    actual: {
      before: videoContent(body).transcriptText,
      after: videoContent(filled).transcriptText,
      notes: filled.startsWith(notes),
      ordering: filled.indexOf('## Imported summary') < filled.indexOf('## Transcript\n'),
    },
    expected: { before: WORDS, after: WORDS, notes: true, ordering: true },
  })
})
