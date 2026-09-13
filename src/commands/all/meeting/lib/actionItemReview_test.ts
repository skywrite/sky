import type { PlaceAnswer } from '#commands/lib/prompt/Prompter.ts'
import { parseActionItemsSection } from '#lib/notebook/actionItems.ts'
import type { DocumentIO, DocumentSnapshot } from '#shared/models/Person/write.ts'
import { assert, test } from '#test'
import { actionItemWithSource, loadActionItemReview, saveActionItemReview } from './actionItemReview.ts'

const FILE = 'time/2026/W05/01-27/actions/meetings/0930_Atlas [planning].md'
const NOTES = `---
who: Jane Doe, Alex Chen
when: 2026-01-27 09:30 - 10:00
summary: Atlas planning
custom: keep this # including the comment
---

# Meeting

## Summary

Keep the release small.

## Action Items (me)

- [ ] Draft the launch checklist
  with the team
- [x] Review the budget

## Action Items (others)

* Alex Chen: check the timeline

## Decisions

Ship in two phases.
`
const WHEN = { date: '2026-01-28', time: null }

function world(content = NOTES) {
  let current: DocumentSnapshot = { path: FILE, content, version: 1 }
  let writes = 0
  const io: DocumentIO = {
    read: () => Promise.resolve(current),
    save: (_file, updated, version) => {
      writes++
      if (version !== current.version) return Promise.resolve({ saved: false, current })
      current = { ...current, content: updated, version: current.version + 1 }
      return Promise.resolve({ saved: true })
    },
  }
  return {
    io,
    content: () => current.content,
    writes: () => writes,
    change: (text: string) => {
      current = { ...current, content: text, version: current.version + 1 }
    },
  }
}

test('meeting action review saves checked and unchecked edits and additions to the source notes', async () => {
  const w = world()
  const review = await loadActionItemReview(
    FILE,
    [{ text: 'Prepare a launch list', mine: true, date: WHEN.date, time: null }],
    w.io,
  )
  assert({
    given: 'filed notes whose wording differs from extraction',
    should: 'show the real meeting and keep its wording with extracted timing',
    actual: [review.source, review.items[0]],
    expected: [
      { title: 'Atlas planning', who: 'Jane Doe, Alex Chen', when: '2026-01-27 09:30 - 10:00', file: FILE },
      { text: 'Draft the launch checklist with the team', mine: true, date: WHEN.date, time: null },
    ],
  })
  const answer: PlaceAnswer = [
    { value: '0', label: 'Draft the Atlas launch checklist', when: WHEN, accepted: true },
    { value: '1', label: 'Review the revised budget', when: WHEN, accepted: false },
    { value: '2', label: 'Alex Chen: confirm the release timeline', when: WHEN, accepted: false },
    { value: 'new-1', label: 'Send the final checklist', when: WHEN, accepted: true },
    { value: 'new-2', label: 'Discuss support coverage', when: WHEN, accepted: false },
  ]
  const result = await saveActionItemReview(review, answer, w.io)
  assert({
    given: 'edits to every row, including someone else’s item, and checked and unchecked additions',
    should: 'persist all corrections while returning only checked tasks, in meeting order',
    actual: [w.content(), result.accepted.map((item) => item.text)],
    expected: [
      NOTES.replace('- [ ] Draft the launch checklist\n  with the team', '- [ ] Draft the Atlas launch checklist')
        .replace(
          '- [x] Review the budget',
          '- [x] Review the revised budget\n- Send the final checklist\n- Discuss support coverage',
        )
        .replace('* Alex Chen: check the timeline', '* Alex Chen: confirm the release timeline'),
      ['Draft the Atlas launch checklist', 'Send the final checklist'],
    ],
  })
  const resumed = await loadActionItemReview(FILE, [], w.io)
  assert({
    given: 'the review reopened after its notes were saved',
    should: 'read edited and new items from the notes',
    actual: resumed.items.map((item) => item.text),
    expected: [
      'Draft the Atlas launch checklist',
      'Review the revised budget',
      'Send the final checklist',
      'Discuss support coverage',
      'Alex Chen: confirm the release timeline',
    ],
  })
  assert({
    given: 'a task moving among day files, the schedule, and Next',
    should: 'carry the meeting title, date, and an encoded notebook-root link',
    actual: actionItemWithSource('Send the final checklist', review.source),
    expected:
      'Send the final checklist — [Atlas planning · 2026-01-27](/time/2026/W05/01-27/actions/meetings/0930_Atlas%20%5Bplanning%5D.md)',
  })
})

test('meeting action review can save notes without accepting any task, and accepts old terminal answers', async () => {
  const w = world()
  const review = await loadActionItemReview(FILE, [], w.io)
  const old = await saveActionItemReview(review, [{ value: '0', when: WHEN }], w.io)
  assert({
    given: 'an unchanged terminal answer with only a value and a date',
    should: 'accept it without rewriting the notes',
    actual: [old.accepted.length, w.writes()],
    expected: [1, 0],
  })
  const none = await saveActionItemReview(
    review,
    [{ value: '2', label: 'Alex Chen: review capacity', when: WHEN, accepted: false }],
    w.io,
  )
  assert({
    given: 'an edited unchecked item and no accepted tasks',
    should: 'save the edit with no task to route',
    actual: [none.accepted, w.content().includes('* Alex Chen: review capacity'), w.writes()],
    expected: [[], true, 1],
  })
})

test('meeting action review adds the first item to a meeting with no extracted actions', async () => {
  const w = world('---\nsummary: Atlas planning\nwhen: 2026-01-27 09:30\n---\n\n# Meeting\n\nKeep this summary.\n')
  const review = await loadActionItemReview(FILE, [], w.io)
  const result = await saveActionItemReview(
    review,
    [{ value: 'new-1', label: 'Follow up with the team', when: WHEN }],
    w.io,
  )
  assert({
    given: 'an empty action-item review with one new task',
    should: 'create its notes section and return the new task',
    actual: [parseActionItemsSection(w.content()).map((item) => item.text), result.accepted.map((item) => item.text)],
    expected: [['Follow up with the team'], ['Follow up with the team']],
  })
})

test('meeting action review preserves concurrent prose edits and refuses conflicting action edits', async () => {
  const w = world()
  const review = await loadActionItemReview(FILE, [], w.io)
  const answer = [{ value: '0', label: 'Draft the launch checklist today', when: WHEN }]
  let conflict = true
  const io: DocumentIO = {
    ...w.io,
    save: (file, content, version) => {
      if (conflict) {
        conflict = false
        w.change(NOTES.replace('Keep the release small.', 'The release now includes accessibility fixes.'))
      }
      return w.io.save(file, content, version)
    },
  }
  await saveActionItemReview(review, answer, io)
  assert({
    given: 'a summary edited between reading and saving the review',
    should: 'retry against the new version and preserve that summary',
    actual: w.content().includes('The release now includes accessibility fixes.'),
    expected: true,
  })
  const changed = world()
  const before = await loadActionItemReview(FILE, [], changed.io)
  changed.change(NOTES.replace('Draft the launch checklist', 'Write the launch plan'))
  let error = ''
  try {
    await saveActionItemReview(before, answer, changed.io)
  } catch (err) {
    error = (err as Error).message
  }
  assert({
    given: 'the same action item edited in another tab',
    should: 'refuse to overwrite it or return tasks for routing',
    actual: [error.includes('changed during review'), changed.writes()],
    expected: [true, 0],
  })
})

test('meeting action review rejects invalid and repeated rows before saving', async () => {
  for (const answer of [
    [{ value: '0', label: ' ', when: WHEN }],
    [{ value: 'new-1', when: WHEN }],
    [{ value: '99', label: 'Unknown', when: WHEN }],
    [
      { value: '0', when: WHEN },
      { value: '0', when: WHEN },
    ],
  ]) {
    const w = world()
    const review = await loadActionItemReview(FILE, [], w.io)
    let rejected = false
    try {
      await saveActionItemReview(review, answer, w.io)
    } catch {
      rejected = true
    }
    assert({
      given: 'an invalid action review',
      should: 'reject it without writing notes',
      actual: [rejected, w.writes()],
      expected: [true, 0],
    })
  }
})
