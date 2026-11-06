import { removeBlock } from '#lib/nbfs/listBlocks.ts'
import { orderPlanList, setPlanOrder } from '#lib/nbfs/planOrder.ts'
import { priorityOrderRows } from '#lib/nbfs/priorityOrder.ts'
import { assert, test } from '#test'
import { prioritySnapshot, reusePrioritySnapshot } from './prioritySnapshot.ts'

const CONTENT = `---
started: 08:00
tz: UTC
---

## Most Important

- Decide the Atlas scope

## Professional Todos

- Review notes
  Notes for the first copy.
- Review notes
  Notes for the second copy.
- Send the agenda

## Reminders

- Pause before replying
`
const CONTEXT = [
  { path: 'goals/Focus.md', text: 'Prepare for the review.', excerpt: false },
  { path: 'projects/Atlas/notes.md', text: 'The review notes.', excerpt: false },
]
const SOURCES = ['goals/', 'projects/Atlas/notes.md']

test('completion and deletion follow duplicate items by their complete notes when occurrences change', () => {
  const saved = prioritySnapshot(CONTENT, CONTEXT)
  const original = priorityOrderRows(CONTENT)
  const deleted = removeBlock(CONTENT, 'Professional Todos', 'Review notes', 0)
  const toggled = orderPlanList(
    CONTENT.replace('- Review notes\n  Notes for the second copy.', '- ~~Review notes~~\n  Notes for the second copy.'),
    'Professional Todos',
  )
  const removed = reusePrioritySnapshot(saved, prioritySnapshot(deleted, CONTEXT), SOURCES)
  const completed = reusePrioritySnapshot(saved, prioritySnapshot(toggled, CONTEXT), SOURCES)
  const afterDeletion = priorityOrderRows(deleted)
  const afterCompletion = priorityOrderRows(toggled)
  assert({
    given: 'duplicate titles with different notes, then deletion of the first or completion of the second',
    should: 'carry each surviving copy’s own ranking across occurrence changes',
    actual: [
      removed?.get(JSON.stringify(afterDeletion[0].entry)),
      completed?.get(JSON.stringify(afterCompletion.find((row) => row.done)!.entry)),
      completed?.get(JSON.stringify(afterCompletion.find((row) => row.block.includes('first copy'))!.entry)),
    ],
    expected: [JSON.stringify(original[1].entry), JSON.stringify(original[1].entry), JSON.stringify(original[0].entry)],
  })
})

test('new evidence invalidates a priority snapshot while progress and explicit ordering reuse its judgment', () => {
  const saved = prioritySnapshot(CONTENT, CONTEXT)
  const reusable = (content: string, context = CONTEXT, sources = SOURCES) =>
    Boolean(reusePrioritySnapshot(saved, prioritySnapshot(content, context), sources))
  const deleted = removeBlock(CONTENT, 'Professional Todos', 'Review notes', 0)
  const overrides = setPlanOrder(
    CONTENT,
    'todo-order',
    priorityOrderRows(CONTENT)
      .reverse()
      .map((row) => ({ ...row.entry, manual: true })),
  )
  assert({
    given: 'progress, a manual move, and edits to the information used for ranking',
    should:
      'reuse only known items with unchanged evidence and distinguish an unselected link from a deleted context file',
    actual: {
      unchanged: reusable(CONTENT),
      cleared: reusable(deleted),
      manual: reusable(overrides),
      linkedItemRemoved: reusable(deleted, CONTEXT.slice(0, 1), ['goals/']),
      contextFileDeleted: reusable(deleted, CONTEXT.slice(0, 1)),
      contextEdited: reusable(CONTENT, [{ ...CONTEXT[0], text: 'The review moved.' }, CONTEXT[1]]),
      added: reusable(CONTENT + '\n- Leave space between meetings\n'),
      notesEdited: reusable(CONTENT.replace('first copy.', 'updated copy.')),
      categoryEdited: reusable(CONTENT.replace('Professional Todos', 'Personal Todos')),
      mostImportantEdited: reusable(CONTENT.replace('Decide the Atlas scope', 'Prepare the Atlas launch')),
      otherDayContent: reusable(CONTENT + '\nA new reflection on the day.\n'),
    },
    expected: {
      unchanged: true,
      cleared: true,
      manual: true,
      linkedItemRemoved: true,
      contextFileDeleted: false,
      contextEdited: false,
      added: false,
      notesEdited: false,
      categoryEdited: false,
      mostImportantEdited: false,
      otherDayContent: false,
    },
  })
})
