import { assert, test } from '#test'
import { compactionLine, contextAdjustmentNote, contextAdjustmentText } from './contextAdjustment.ts'

test('a compaction says what it cleared, in the conversation and in the full note', () => {
  const both = { shortenedToolResults: 14, compactedSources: 3, compacted: { toolResults: 14, notes: 249 } }
  const one = { shortenedToolResults: 1, compacted: { toolResults: 1, notes: 0 } }
  const notes = { shortenedToolResults: 0, notebookTokens: 410_000, compacted: { toolResults: 0, notes: 1 } }
  assert({
    given: 'compactions that cleared tool results and notes, one tool result, and one note',
    should: 'name each kind it cleared with its count, and never repeat the older reduction notes beside it',
    actual: [compactionLine(both), compactionLine(one), compactionLine(notes), contextAdjustmentText(both)],
    expected: [
      'compacted to make room · cleared 14 older tool results and 249 notes',
      'compacted to make room · cleared 1 older tool result',
      'compacted to make room · cleared 1 note',
      'Compacted to make room: cleared 14 older tool results and 249 notes. Sky can look up anything it cleared, and your messages and its replies are unchanged.',
    ],
  })
})

test('the note under a compacted reply says what it means and leaves the counts to the line above', () => {
  const compacted = { shortenedToolResults: 2, referencedAttachments: 1, compacted: { toolResults: 2, notes: 5 } }
  assert({
    given: 'a compacted reply that also had an earlier attachment swapped for a reference',
    should: 'reassure once, keep the attachment note, and not count what was cleared a second time',
    actual: contextAdjustmentNote(compacted),
    expected:
      'Sky can look up anything it cleared, and your messages and its replies are unchanged. Earlier attachments are available by file reference. Their originals and recorded findings are preserved.',
  })
})

test('a reduction that was not a compaction reads as it always did', () => {
  const reduced = { shortenedToolResults: 1, notebookTokens: 60_000 }
  assert({
    given: 'a reply saved before compaction existed, or one oversized result shortened as it arrived',
    should: 'show no compaction line and keep the earlier wording',
    actual: [
      compactionLine(reduced),
      contextAdjustmentNote(reduced),
      contextAdjustmentNote(reduced) === contextAdjustmentText(reduced),
    ],
    expected: [
      null,
      'Notebook reading reduced to about 60k tokens to fit this conversation. Earlier tool results were shortened for this reply. The complete results remain in the conversation history.',
      true,
    ],
  })
})
