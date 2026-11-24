import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { updateOpenDecision, writeDecision } from '#commands/all/decisions/lib/write.ts'
import { sampleDecidedPlan, sampleDecidingPlan } from '#lib/decisionWizard/testHelpers.ts'
import type { DecisionThinking } from '#lib/decisionWizard/think.ts'
import slugify from '#lib/string/slugify.ts'
import { sleepInput, TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import IdeaStore from '#shared/models/Store/IdeaStore/mod.ts'
import StreakStore from '#shared/models/Store/StreakStore/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { DecisionCommands, DecisionCreate, DecisionSettle } from './decisionCommands.ts'
import { createFutureRoutes } from './mod.ts'
import { type FutureNotebook, FutureStore } from './store.ts'
import { DecisionWizard } from './wizard.ts'

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
 * A small notebook: three goals, one with a number, one of each thing that can be tied to a goal, a goal that
 * was reached, and one archived before endings were recorded.
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
      'goals/reached/2029/Run-a-5k.md',
      '---\ntitle: Run a 5k\ncategory: Personal\nended: 2029-09-01\nfinal: 3.1 mi\n---\n\n# Run a 5k\n',
    )
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
  // The decision commands, stood in for: the writes go through the same write core the real
  // commands use, into this notebook, and each to-do or reminder asked for is kept to look at.
  const created: DecisionCreate[] = []
  /** Each open decision settled as made, as the wizard asked for it */
  const made: Array<Omit<DecisionSettle, 'file'>> = []
  /** Each rewrite of an open decision's file, by the title it was written with */
  const updated: string[] = []
  const items: Array<{ task: string; list: string; when: string; category: string }> = []
  const dirs = { decisionsDir: path.join(root, 'decisions'), timeDir: path.join(root, 'time') }
  const at = (day: string) => new ZonedDateTime(new PlainDateTime('08:15', day), 'America/Chicago')
  const commands: DecisionCommands = {
    async create(input) {
      created.push(input)
      const name = slugify(input.title, { suggestedLength: 25, preserveCase: true })
      const { rel, category, when, noEditor: _noEditor, ...fields } = input
      const written = await writeDecision(
        { ...fields, name, rel, now: at(when ?? TRACKING_TODAY), category: `${category} Complete` },
        dirs,
      )
      return { name, file: written.file }
    },
    async update(input) {
      updated.push(input.title)
      const written = await updateOpenDecision({ ...input, today: new PlainDate(TRACKING_TODAY) })
      return { text: written.markdown, edited: written.edited }
    },
    async settle({ file, rel, category, ...fields }) {
      made.push({ ...fields, rel, category })
      const open = DecisionDocument.fromMarkdown(await readFile(file, 'utf8'))
      const written = await writeDecision(
        {
          ...fields,
          name: open.name,
          rel,
          now: at(TRACKING_TODAY),
          category: `${category} Complete`,
          settles: { file, identified: open.identified ?? at(TRACKING_TODAY) },
        },
        dirs,
      )
      return { name: open.name, file: written.file }
    },
    async addItem(input) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.when)) throw new Error('That is not a day.')
      items.push(input)
    },
  }
  // Sky's thinking, stood in for: the sample plans, at once. A statement with "fail" in it does not come back,
  // and one with "slow" in it takes a few seconds, long enough for a page to be seen following it.
  const thought: Array<{ statement: string; decided: boolean }> = []
  const read = { goals: 2, inForce: 1, notes: 9 }
  const thinking: DecisionThinking = {
    async find({ known }) {
      if (known.includes('fail to look')) throw new Error('The model did not answer.')
      return [
        {
          title: 'Hire a VP of Sales now, or after the October launch',
          why: 'You went back and forth on this in your journal on Jun 12.',
          decided: false,
        },
        {
          title: 'No senior hires before the Series B closes',
          why: 'You told the leadership meeting on Mar 12.',
          decided: true,
        },
        { title: 'Which race to enter', why: 'It is already written down.', decided: false },
      ]
    },
    async plan(input, progress) {
      thought.push({ statement: input.statement, decided: input.decided })
      progress('reading')
      progress('thinking', read)
      if (input.statement.includes('fail')) throw new Error('The model did not answer.')
      if (input.statement.includes('slow')) await new Promise((resolve) => setTimeout(resolve, 3000))
      progress('writing', read)
      return {
        plan: input.decided ? sampleDecidedPlan() : sampleDecidingPlan(),
        read,
        related: 'the notes it rested on',
      }
    },
    async addOption({ plan, text }) {
      if (text.includes('fail')) throw new Error('The model did not answer.')
      const added = { ...plan.options[2]!, title: text, short: text, mine: true, hinges: [] }
      return { ...plan, options: [...plan.options, added], rank: [...plan.rank, plan.options.length] }
    },
    async addWant({ plan, text }) {
      return {
        ...plan,
        wants: [...plan.wants, { title: text, why: 'You added this.', ref: null, inForce: false }],
        options: plan.options.map((option) => ({ ...option, effects: [...option.effects, 'none' as const] })),
      }
    },
  }
  const today = async () => new PlainDate(TRACKING_TODAY)
  // Each decision the wizard reports as in the notebook, for the chat about it to point to.
  const filed: Array<[run: string, name: string]> = []
  const wizard = new DecisionWizard({
    dir: path.join(root, '.state', 'decisions'),
    thinking,
    commands,
    notebook: () => (ready ? notebook : null),
    today,
    filed: async (run, name) => void filed.push([run, name]),
  })
  const store = new FutureStore(
    { root, goalsDir: path.join(root, 'goals') },
    () => (ready ? notebook : null),
    tracking.store,
    today,
    () => wizard.list(),
  )
  const app = createFutureRoutes({ store, wizard })
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const goalFile = (name: string, folder = 'active') => readFile(path.join(root, 'goals', folder, `${name}.md`), 'utf8')
  /** Wait for a run's thinking to come back, as the page does by reading it again. */
  const settled = async (id: string) => {
    for (let tries = 0; tries < 200; tries++) {
      const run = await wizard.get(id)
      if (run.status !== 'thinking' && !(run.adding && !run.adding.error)) return run
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('The run never settled.')
  }
  return {
    root,
    store,
    wizard,
    app,
    post,
    goalFile,
    tracking,
    created,
    updated,
    made,
    items,
    filed,
    thought,
    settled,
    dispose: tracking.dispose,
  }
}
