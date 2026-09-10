import DayDocument from '#shared/models/Day/document/mod.ts'
import { assert, test } from '#test'
import { orderPlanList } from './order.ts'
import { addPlanItem } from './planningText.ts'

const TODO_BLOCKS = [
  '- Draft [Atlas][brief]\n  Keep this note with the draft.\n  - A nested checklist item',
  '* ~~Send the invoice~~',
  '+ Review the outline',
  '- ~~Book the room~~',
]
const prefix =
  '---\nstarted: 08:00\n---\n\n# A sample day\n\n## Professional Todos\n\nAn example:\n\n```md\n- ~~Not a task~~\n```\n\n'
const suffix = '\n\n## Personal Todos\n\n- Water the plants\n- ~~Book a table~~\n\n[brief]: https://example.com/atlas\n'

test('day ordering carries task notes and links, preserves stable groups, and leaves neighboring lists alone', () => {
  for (const eol of ['\n', '\r\n']) {
    const original = (prefix + TODO_BLOCKS.join('\n') + suffix).replace(/\n/g, eol)
    const expected = (
      prefix +
      [TODO_BLOCKS[1], TODO_BLOCKS[3], TODO_BLOCKS[0], TODO_BLOCKS[2]].join('\n') +
      suffix
    ).replace(/\n/g, eol)
    const ordered = orderPlanList(original, 'Professional Todos')
    assert({
      given: `a list with mixed markers, nested notes, references and ${JSON.stringify(eol)} line endings`,
      should: 'group completed items stably while preserving all other bytes',
      actual: ordered,
      expected,
    })
    assert({
      given: 'an already ordered list',
      should: 'leave it unchanged on retry',
      actual: orderPlanList(ordered, 'Professional Todos'),
      expected: ordered,
    })
  }
})

test('completed commitments lead, with time order within each group including extended hours', () => {
  const rows = [
    '- 08:00 > Early open task',
    '- 25:30 > ~~Late completed task~~',
    '- 09:30 > ~~First completed task~~',
    '- 17:00 > Later open task',
    '- 09:30 > ~~Second completed task~~',
    '- ~~Completed without a time~~',
  ]
  const head = '## Professional Commitments\n\n'
  const original = head + rows.join('\n')
  const expected = head + [rows[2], rows[4], rows[1], rows[5], rows[0], rows[3]].join('\n')
  assert({
    given: 'completed and open commitments in mixed order without a final newline',
    should: 'sort completed first, then by time, keeping equal times stable and untimed items last',
    actual: orderPlanList(original, 'Professional Commitments'),
    expected,
  })
  const added = addPlanItem(expected, {
    kind: 'commitments',
    text: 'New open task',
    category: 'Professional',
    time: '07:00',
  })
  assert({
    given: 'an early commitment added after completion',
    should: 'keep the completed group at the top of the saved list',
    actual: DayDocument.fromMarkdown(added.content).lists[0].items.map((item) => DayDocument.isItemDone(item)),
    expected: [true, true, true, true, false, false, false],
  })
})

test('unchecking a task returns it to the open group and reminders are never reordered', () => {
  const content =
    '## Professional Todos\n\n- ~~First done~~\n- ~~Second done~~\n- Open task\n\n## Reminders\n\n- Remember a walk\n- ~~Existing reminder~~\n'
  const changed = DayDocument.toggleItem(content, 'Professional Todos', 'First done', false)
  const expected = content.replace('- ~~First done~~\n- ~~Second done~~', '- ~~Second done~~\n- First done')
  assert({
    given: 'a completed to-do reopened from its list',
    should: 'place it after completed items and keep the remaining order',
    actual: changed.kind === 'written' ? orderPlanList(changed.content, 'Professional Todos') : changed.kind,
    expected,
  })
  assert({
    given: 'a reminder list and a missing heading',
    should: 'leave them untouched',
    actual: [orderPlanList(content, 'Reminders'), orderPlanList(content, 'Missing Todos')],
    expected: [content, content],
  })
})
