import { assert, test } from '#test'
import type { DayItem } from './day.tsx'
import { priorityItems } from './priorityItems.ts'

const item = (
  text: string,
  priority: number,
  time: string | null = null,
  done = false,
  list = 'Professional Todos',
): DayItem => ({
  text,
  raw: time ? `${time} > ${text}` : text,
  time,
  priority,
  done,
  list,
  category: list.startsWith('Personal') ? 'Personal' : 'Professional',
  link: null,
  occurrence: 0,
  revision: 'sample-revision',
})

test('To-dos rank by priority across category and time, with completed tasks separate', () => {
  const items = [
    item('Late call', 4, '25:30', false, 'Personal Commitments'),
    item('Write the Atlas brief', 0),
    item('Atlas planning', 3, '09:30', false, 'Professional Commitments'),
    item('Book a checkup', 1, null, false, 'Personal Todos'),
    item('Completed plan', 2, '06:00', true, 'Professional Commitments'),
  ]
  const { open, completed } = priorityItems(items, (row) => row.done)
  assert({
    given: 'an untimed personal task ranked above timed work and a completed high-priority task',
    should: 'follow priority without category grouping or time taking precedence, retaining original write addresses',
    actual: {
      open: open.map((row) => row.text),
      completed: completed.map((row) => row.text),
      retained: open[0] === items[1] && items[0].text === 'Late call',
    },
    expected: {
      open: ['Write the Atlas brief', 'Book a checkup', 'Atlas planning', 'Late call'],
      completed: ['Completed plan'],
      retained: true,
    },
  })
})

test('pending completion brings the next highest priority into the top five', () => {
  const items = Array.from({ length: 8 }, (_, index) => item(`Task ${index + 1}`, index))
  const rows = priorityItems(items, (row) => row === items[0])
  assert({
    given: 'eight ranked to-dos and a checkbox write still pending',
    should: 'fill the five visible places from open items and retain the completed task separately',
    actual: [rows.open.slice(0, 5).map((row) => row.text), rows.open.length - 5, rows.completed[0] === items[0]],
    expected: [['Task 2', 'Task 3', 'Task 4', 'Task 5', 'Task 6'], 2, true],
  })
})
