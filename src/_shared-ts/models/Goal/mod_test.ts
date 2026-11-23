import { assert, test } from '#test'
import GoalDocument, { endedGoalsDir, goalStatusFromPath, isOneGoalFile } from './mod.ts'

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

test('goal paths: the folder a goal sits in is its status', () => {
  const files = [
    '/nb/goals/active/Launch-Atlas.md',
    '/nb/goals/reached/2026/Launch-Atlas.md',
    '/nb/goals/missed/2026/Launch-Atlas.md',
    '/nb/goals/dropped/2026/Launch-Atlas.md',
    '/nb/goals/reached/Launch-Atlas.md',
    '/nb/goals/archived/2025/Launch-Atlas.md',
    '/nb/goals/personal.md',
    '/home/dropped/nb/goals/active/Launch-Atlas.md',
    '/home/reached/nb/goals/personal.md',
  ]

  assert({
    given:
      'a goal in each folder, one filed without a year, an older ended goal, an older category file, and notebooks kept under folders named like an ending',
    should: 'read the status from the goal folder alone, and tell a one-goal file from a category file',
    actual: files.map((file) => [goalStatusFromPath(file), isOneGoalFile(file)]),
    expected: [
      ['active', true],
      ['reached', true],
      ['missed', true],
      ['dropped', true],
      ['reached', true],
      ['archived', true],
      ['active', false],
      ['active', true],
      ['active', false],
    ],
  })

  assert({
    given: 'a goal that was missed in 2026',
    should: 'file it under that ending and that year',
    actual: endedGoalsDir('/nb/goals', 'missed', 2026),
    expected: '/nb/goals/missed/2026',
  })
})

test('GoalDocument: an ended goal says when it ended and where its number stood', () => {
  const ended = GoalDocument.fromMarkdown('---\ntitle: Run a marathon\nended: 2026-10-04\nfinal: 26.4 mi\n---\n\nBody.')
  const bare = GoalDocument.fromMarkdown('---\ntitle: Read 20 books\nended: soon\nfinal: 21\n---\n\nBody.')

  assert({
    given: 'an ended goal with its last reading as text, and one with a bare number and a date that is not a date',
    should: 'read the day and the reading as written, and no day when it is not one',
    actual: [ended.ended?.ymd, ended.final, bare.ended, bare.final, GoalDocument.fromMarkdown('# Open').final],
    expected: ['2026-10-04', '26.4 mi', undefined, '21', undefined],
  })
})
