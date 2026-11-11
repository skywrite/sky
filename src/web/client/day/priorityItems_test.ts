import { assert, test } from '#test'
import type { DayItem } from './day.tsx'
import { organizeGroup, priorityItems } from './priorityItems.ts'

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

test('timed to-dos sit above untimed ones, each ranked by priority across category', () => {
  const items = [
    item('Late call', 4, '25:30', false, 'Personal Commitments'),
    item('Write the Atlas brief', 0),
    item('Atlas planning', 3, '09:30', false, 'Professional Commitments'),
    item('Book a checkup', 1, null, false, 'Personal Todos'),
    item('Completed plan', 2, '06:00', true, 'Professional Commitments'),
  ]
  const { open, completed } = priorityItems(items, (row) => row.done)
  assert({
    given: 'untimed tasks ranked above timed work and a completed high-priority task',
    should: 'put every timed task first, follow priority within each kind, and retain original write addresses',
    actual: {
      open: open.map((row) => row.text),
      completed: completed.map((row) => row.text),
      retained: open[0] === items[2] && items[0].text === 'Late call',
    },
    expected: {
      open: ['Atlas planning', 'Late call', 'Write the Atlas brief', 'Book a checkup'],
      completed: ['Completed plan'],
      retained: true,
    },
  })
})

test('a timed to-do leads the top five even when it ranks last', () => {
  const items = [
    ...Array.from({ length: 6 }, (_, index) => item(`Task ${index + 1}`, index)),
    item('Call Jane Doe', 6, '14:30', false, 'Professional Commitments'),
  ]
  const { open } = priorityItems(items, (row) => row.done)
  assert({
    given: 'six untimed to-dos ranked above the only timed one',
    should: 'show the timed to-do first and keep it from dragging among the untimed ones',
    actual: [open.slice(0, 5).map((row) => row.text), organizeGroup(open[0]) === organizeGroup(open[1])],
    expected: [['Call Jane Doe', 'Task 1', 'Task 2', 'Task 3', 'Task 4'], false],
  })
})

test('timed to-dos follow the clock whatever their priority, extended hours last', () => {
  const items = [
    item('Late call', 0, '25:30', false, 'Personal Commitments'),
    item('Review the launch plan', 1, '14:00', false, 'Professional Commitments'),
    item('Check in with Jane Doe', 2, '9:30', false, 'Professional Commitments'),
    item('Evening walk', 3, '23:00', false, 'Personal Commitments'),
  ]
  assert({
    given: 'timed to-dos ranked in reverse clock order, one past midnight',
    should: 'list them earliest first',
    actual: priorityItems(items, (row) => row.done).open.map((row) => row.text),
    expected: ['Check in with Jane Doe', 'Review the launch plan', 'Evening walk', 'Late call'],
  })
})

test('a time on a reminder does not reorder reminders', () => {
  const items = [
    item('Pause before replying', 0, null, false, 'Reminders'),
    item('Stretch', 1, '15:00', false, 'Reminders'),
  ]
  assert({
    given: 'a reminder with a time ranked below one without',
    should: 'keep the reminders in priority order',
    actual: priorityItems(items, (row) => row.done).open.map((row) => row.text),
    expected: ['Pause before replying', 'Stretch'],
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
