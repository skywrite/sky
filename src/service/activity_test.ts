import { assert, test } from '#test'
import { hold, holding, onRelease, touch } from './activity.ts'

test({ name: 'activity - holds are listed while held, and every release is heard' }, async () => {
  const releases: string[][] = []
  const stop = onRelease(() => releases.push(holding()))
  const turn = hold('chat turn')
  const run = hold('import')
  const during = holding()
  turn()
  turn()
  run()
  stop()
  assert({
    given: 'two holds, the first released twice',
    should: 'list both while held, hear two releases, and end with nothing held',
    actual: { during, releases, after: holding() },
    expected: { during: ['chat turn', 'import'], releases: [['import'], []], after: [] },
  })
})

test({ name: 'activity - describing the next step does not release or revive a hold' }, async () => {
  const releases: string[][] = []
  const stop = onRelease(() => releases.push(holding()))
  const background = hold('background activity check')
  const importing = hold('import')
  background.update('Slack follow check')
  const during = { holding: holding(), releases: [...releases] }
  background()
  background.update('email follow sync')
  const after = holding()
  importing()
  stop()
  assert({
    given: 'background work moving to its next step, then updated again after it ended',
    should: 'describe the active work without an idle gap, keep other holds, and stay released after ending',
    actual: { during, after, releases, ended: holding() },
    expected: {
      during: { holding: ['Slack follow check', 'import'], releases: [] },
      after: ['import'],
      releases: [['import'], []],
      ended: [],
    },
  })
})

test({ name: 'activity - a timed hold lasts while it is touched, and lets go after the last touch' }, async () => {
  touch('voice:a', 'voice', 40)
  await new Promise((resolve) => setTimeout(resolve, 25))
  touch('voice:a', 'voice', 40)
  const afterRenewal = holding()
  await new Promise((resolve) => setTimeout(resolve, 25))
  const stillHeld = holding()
  await new Promise((resolve) => setTimeout(resolve, 30))
  const expired = holding()
  touch('voice:b', 'voice', 1000)
  touch('voice:b', 'voice', 0)
  assert({
    given: 'a hold touched again before it lapses, then left alone; and one cleared with zero',
    should: 'stay held past the first lifetime, lapse after the renewed one, and clear at once',
    actual: { afterRenewal, stillHeld, expired, cleared: holding() },
    expected: { afterRenewal: ['voice'], stillHeld: ['voice'], expired: [], cleared: [] },
  })
})
