import { assert, test } from '#test'
import GoalDocument from './mod.ts'

test('GoalDocument: a goal reads its number, its dates and its checkpoints from the frontmatter', () => {
  const goal = GoalDocument.fromMarkdown(
    [
      '---',
      'title: Run a marathon',
      'category: Personal',
      'start: 2026-02-01',
      'due: 2026-10-04',
      'track: tracking/long-run',
      'target: 26.2',
      'checkpoints:',
      '  - 20 by 2026-08-01',
      '  - 13.1 by 2026-05-01',
      '  - twenty-something by August',
      '  - 22 by 2026-13-40',
      'serves: goals/Get-Fit',
      '---',
      '',
      'Finish one this year.',
    ].join('\n'),
  )

  assert({
    given: 'a goal with a start, a due date, a tracker, a target, four checkpoint lines and a goal it serves',
    should: 'read each one, keep only the checkpoint lines that are a number by a real date, oldest first',
    actual: {
      start: goal.start?.ymd,
      due: goal.due?.ymd,
      track: goal.track,
      target: goal.target,
      checkpoints: goal.checkpoints.map((c) => `${c.value} by ${c.date.ymd}`),
      serves: goal.serves,
    },
    expected: {
      start: '2026-02-01',
      due: '2026-10-04',
      track: 'long-run',
      target: 26.2,
      checkpoints: ['13.1 by 2026-05-01', '20 by 2026-08-01'],
      serves: 'Get-Fit',
    },
  })
})

test('GoalDocument: a goal with none of those fields has none of them', () => {
  const goal = GoalDocument.fromMarkdown('---\ntitle: Learn Spanish\ndue: someday\ntarget: lots\n---\n\nBody.')

  assert({
    given: 'a goal with only a title, a date that is not a date and a target that is not a number',
    should: 'report nothing rather than a guess',
    actual: [goal.start, goal.due, goal.track, goal.target, goal.checkpoints, goal.serves],
    expected: [undefined, undefined, undefined, undefined, [], undefined],
  })
})
