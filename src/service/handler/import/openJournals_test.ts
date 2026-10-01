import { assert, test } from '#test'
import { openJournals } from './openJournals.ts'

test('journal tabs use the OS opener with distinct, encoded local Explorer URLs', async () => {
  const calls: string[][] = []
  await openJournals(
    [
      'time/2031/journal/Health_Long Walk & Rest.md',
      'time/2031/journal/Gratitude_Atlas?#.md',
      'time/2031/journal/Health_Long Walk & Rest.md',
    ],
    4321,
    async (command, args = []) => {
      calls.push([command, ...args])
      return { success: true, code: 0, stdout: '', stderr: '' }
    },
  )
  assert({
    given: 'multiple saved journals, including a duplicate and filename URL punctuation',
    should: 'open each distinct journal using the configured service without grouped-document query parameters',
    actual: calls,
    expected: [
      [
        'open',
        'http://localhost:4321/explorer/time/2031/journal/Health_Long%20Walk%20%26%20Rest.md',
        'http://localhost:4321/explorer/time/2031/journal/Gratitude_Atlas%3F%23.md',
      ],
    ],
  })
})

test('invalid journal paths cannot reach the OS opener', async () => {
  let calls = 0
  const errors = await Promise.all(
    [[], ['/tmp/journal.md'], ['../journal.md'], ['time/./journal.md']].map((files) =>
      openJournals(files, 4321, async () => {
        calls++
        return { success: true, code: 0, stdout: '', stderr: '' }
      }).then(
        () => null,
        (error: Error) => error.message,
      ),
    ),
  )
  assert({
    given: 'missing, absolute, or traversing result paths',
    should: 'reject every request before launching anything',
    actual: [errors.every((error) => error === 'There are no valid saved journals to open.'), calls],
    expected: [true, 0],
  })
})

test('an OS opener failure reports that the journals are still saved', async () => {
  const error = await openJournals(['time/2031/journal/Health_Walking.md'], 4321, async () => ({
    success: false,
    code: 1,
    stdout: '',
    stderr: 'synthetic launch failure',
  })).then(
    () => null,
    (error: Error) => error.message,
  )
  assert({
    given: 'the OS rejects an opening request',
    should: 'return a failure the import UI can display without rerunning the import',
    actual: error,
    expected: 'The journals were saved, but their browser tabs could not be opened.',
  })
})
