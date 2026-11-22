import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { sleepInput, TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import IdeaStore from '#shared/models/Store/IdeaStore/mod.ts'
import StreakStore from '#shared/models/Store/StreakStore/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createFutureRoutes } from './mod.ts'
import { type FutureNotebook, FutureStore } from './store.ts'

const decision = (name: string, summary: string, extra: string, rel: string[]) =>
  [
    '---',
    `name: ${name}`,
    `summary: ${summary}`,
    'identified: 2030-03-02T09:00:00-06:00[America/Chicago]',
    extra,
    'rel:',
    ...rel.map((entry) => `  - ${entry}`),
    '---',
    '',
    `# ${summary}`,
    '',
  ]
    .filter((line) => line !== 'none')
    .join('\n')

/**
 * A small notebook: three goals, one with a number, and one of each thing that can be tied to a goal.
 * `goals: false` leaves it with a tracker and nothing else, as a new notebook is.
 */
export async function futureFixture({ ready = true, goals = true } = {}) {
  const tracking = await trackingFixture()
  const { root, put } = tracking
  await tracking.store.create(crypto.randomUUID(), {
    ...sleepInput,
    title: 'Long run',
    start: '2030-01-01',
    columns: [{ name: 'distance', type: 'number', unit: 'mi', aggregate: 'last' }],
  })
  await put('data/tracking/2030/long-run.csv', 'date, distance (mi)\n2030-05-01, 6\n2030-05-20, 10\n2030-06-17, 14\n')
  if (goals) {
    await put(
      'goals/active/Run-a-Marathon.md',
      [
        '---',
        'title: Run a marathon',
        'category: Personal',
        'start: 2030-05-01',
        'due: 2030-10-04',
        'track: long-run',
        'target: 26.2',
        'checkpoints:',
        '  - 10 by 2030-06-01',
        '  - 20 by 2030-06-10',
        '  - 22 by 2030-09-01',
        'created: 2030-01-05',
        '---',
        '',
        '# Run a marathon',
        '',
        'Finish one **this year**. <script>alert(1)</script>',
        '',
      ].join('\n'),
    )
    await put(
      'goals/active/Weekly-Long-Runs.md',
      '---\ntitle: A long run every week\ncategory: Personal\nserves: goals/Run-a-Marathon\n---\n\n# A long run every week\n',
    )
    await put(
      'goals/active/Learn-Spanish.md',
      '---\ntitle: Learn Spanish\ncategory: Personal\ntrack: vocabulary\ntarget: 2000\n---\n\n# Learn Spanish\n',
    )
    await put('goals/archived/2029/Run-a-10k.md', '---\ntitle: Run a 10k\n---\n\n# Run a 10k\n')
    await put(
      'decisions/2030/in-force/03/No-Late-Nights.md',
      decision(
        'No-Late-Nights',
        'No late nights before a long run',
        'resolved: 2030-03-02T09:00:00-06:00[America/Chicago]\ninForce: true',
        ['goals/run-a-marathon', 'goals/Learn-Spanish'],
      ),
    )
    await put(
      'decisions/2030/pending/03/Which-Race.md',
      decision('Which-Race', 'Which race to enter', 'none', ['goals/Run-a-Marathon']),
    )
    await put(
      'decisions/2030/resolved/03/Hire-a-Coach.md',
      decision('Hire-a-Coach', 'Hire a coach', 'resolved: 2030-04-01T09:00:00-06:00[America/Chicago]', [
        'goals/Run-a-Marathon',
      ]),
    )
    await put(
      'ideas/draft/Join-a-Running-Club.md',
      '---\nname: Join-a-Running-Club\ntitle: Join a running club\nrel:\n  - goals/Run-a-Marathon\n---\n\n# Join a running club\n',
    )
    await put(
      'streaks/active/run-before-work.md',
      '---\nname: run-before-work\ntitle: Run before work\nschedule: daily\nstart: 2030-05-01\nrel:\n  - goals/Run-a-Marathon\n---\n\n# Run before work\n',
    )
  }
  const notebook: FutureNotebook = {
    goals: await GoalStore.build(path.join(root, 'goals')),
    decisions: await DecisionStore.build(path.join(root, 'decisions')),
    ideas: await IdeaStore.build(path.join(root, 'ideas')),
    streaks: await StreakStore.build(path.join(root, 'streaks')),
  }
  const store = new FutureStore(
    { root, goalsDir: path.join(root, 'goals') },
    () => (ready ? notebook : null),
    tracking.store,
    async () => new PlainDate(TRACKING_TODAY),
  )
  const app = createFutureRoutes({ store })
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const goalFile = (name: string) => readFile(path.join(root, 'goals/active', `${name}.md`), 'utf8')
  return { root, store, app, post, goalFile, tracking, dispose: tracking.dispose }
}
