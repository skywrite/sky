import { assert, test } from '#test'
import { appendScheduledBlock, removeEmptyDates } from './scheduledItems.ts'

test('a new schedule date puts its task directly under the heading', () => {
  const schedule = '# Schedule\n\n## 2031-03-24\n- Review Atlas\n'
  assert({
    given: 'a task for a date before the existing one, and one after every date in a file ending in a blank line',
    should: 'write each task on the line under its new heading, with one blank line between dates',
    actual: [
      appendScheduledBlock(schedule, '2031-03-17', '- 09:00 > Plan the launch'),
      appendScheduledBlock(`${schedule}\n`, '2031-03-31', '- Send the invoice'),
    ],
    expected: [
      '# Schedule\n\n## 2031-03-17\n- 09:00 > Plan the launch\n\n## 2031-03-24\n- Review Atlas\n',
      '# Schedule\n\n## 2031-03-24\n- Review Atlas\n\n## 2031-03-31\n- Send the invoice\n',
    ],
  })
})

test('emptied schedule dates leave with their headings and blank lines', () => {
  const schedule = [
    '# Schedule',
    '',
    '## 2031-03-10',
    '',
    '',
    '## 2031-03-11',
    'Bring the badge.',
    '',
    '## 2031-03-12',
    '- 09:00 > Missed call',
    '',
    '## Someday',
    '',
    '## 2031-03-17',
    '',
    '',
    '',
    '## 2031-03-20',
    '',
    '## 2031-03-24',
    '- Review Atlas',
    '',
    '## 2031-03-14',
    '-',
    '',
  ].join('\n')
  assert({
    given: 'empty dates before and on the started day, past dates holding a note or a task, and later dates',
    should: 'remove only the empty dates through that day, and end the file with one line break',
    actual: removeEmptyDates(schedule, '2031-03-17'),
    expected: [
      '# Schedule',
      '',
      '## 2031-03-11',
      'Bring the badge.',
      '',
      '## 2031-03-12',
      '- 09:00 > Missed call',
      '',
      '## Someday',
      '',
      '## 2031-03-20',
      '',
      '## 2031-03-24',
      '- Review Atlas',
      '',
    ].join('\n'),
  })
})
