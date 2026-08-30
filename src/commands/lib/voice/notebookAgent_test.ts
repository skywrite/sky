import { assert, test } from '#test'
import { describeNotebookPath } from './notebookAgent.ts'

test('describeNotebookPath turns path segments into kind + date headings', () => {
  assert({
    given: 'a journal entry path',
    should: 'label it Journal with its calendar date',
    expected: 'Journal — 2026-02-08 — 01_video_Some-Entry',
    actual: describeNotebookPath('/base/time/2026/02/02-08/02-08/journal/01_video_Some-Entry.md'),
  })

  assert({
    given: 'a meeting under actions/',
    should: 'label it Meeting with its date',
    expected: 'Meeting — 2026-03-16 — In-Person_Jane-Doe_Atlas-Sync',
    actual: describeNotebookPath('/base/time/2026/03/16-22/03-16/actions/meetings/In-Person_Jane-Doe_Atlas-Sync.md'),
  })

  assert({
    given: 'a week folder crossing the year boundary',
    should: 'roll the year forward for January files in a December week',
    expected: 'Message — 2026-01-02 — email_Jane_Hello',
    actual: describeNotebookPath('/base/time/2025/12/29-04/01-02/actions/messages/email_Jane_Hello.md'),
  })

  assert({
    given: 'a person profile',
    should: 'label it as a profile by name',
    expected: 'Person profile — Jane-Doe',
    actual: describeNotebookPath('/base/people/2020/ja/Jane-Doe.md'),
  })

  assert({
    given: 'an unrecognized path shape',
    should: 'fall back to the raw path',
    expected: '/somewhere/else/readme.md',
    actual: describeNotebookPath('/somewhere/else/readme.md'),
  })
})
