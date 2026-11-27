import { readdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { DecidedAnswers, DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import type { DecidingPlan } from '#lib/decisionWizard/plan.ts'
import { sampleDecidedPlan } from '#lib/decisionWizard/testHelpers.ts'
import { exists } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { futureFixture } from './testHelpers.ts'
import { DecisionWizard } from './wizard.ts'

/** Every step of the full path answered, with a call that differs from Sky's. */
const FULL: DecidingAnswers = {
  frame: 1,
  care: 'full',
  wants: [0, 1, 2],
  top: 0,
  options: [0, 2, 3],
  odds: { 0: 1, 2: 2, 3: 3 },
  hinge: 'now',
  call: 3,
  final: 'keep',
  wrong: { 3: ['You set no end date.'] },
  rules: { 3: ['Review it on Dec 31.'] },
  expect: { 3: 'By Dec 31, $1.8M in new bookings.' },
  sure: 3,
  look: ['2030-09-01', '2030-12-31'],
}
const decisionFiles = async (root: string) =>
  ((await readdir(path.join(root, 'decisions'), { recursive: true })) as string[])
    .filter((file) => file.endsWith('.md'))
    .sort()

test('decision wizard: Sky thinks once in the background, and a failed think says so and can start again', async () => {
  const f = await futureFixture()
  try {
    const started = await (
      await f.post('/decisions/wizard', { statement: '  Hire a VP of Sales now, or after the launch ', decided: false })
    ).json()
    const ready = await f.settled(started.id)
    assert({
      given: 'a decision said in plain words',
      should: 'start thinking at once, then hold the plan with what Sky read, and nothing answered yet',
      actual: [
        [started.status, started.stage, started.plan],
        [ready.status, ready.stage, ready.plan?.kind, ready.read, ready.answers, ready.error],
        f.thought,
      ],
      expected: [
        ['thinking', 'reading', null],
        ['ready', null, 'deciding', { goals: 2, inForce: 1, notes: 9 }, {}, null],
        [{ statement: 'Hire a VP of Sales now, or after the launch', decided: false }],
      ],
    })

    const failing = await f.wizard.start({ statement: 'this one will fail', decided: false })
    const failed = await f.settled(failing.id)
    const blocked = await f.post(`/decisions/wizard/${failing.id}/progress`, { answers: {}, step: 'frame' })
    assert({
      given: 'a think that does not come back',
      should: 'say what happened in words, and refuse answers until there is a plan',
      actual: [failed.status, failed.error, blocked.status],
      expected: ['failed', 'Sky could not think this through: The model did not answer.', 409],
    })

    // A run left "thinking" on disk, read by a wizard that is not thinking: the service after a restart.
    const runs = path.join(f.root, '.state', 'decisions', 'runs')
    const stuckId = crypto.randomUUID()
    const left = JSON.parse(await readFile(path.join(runs, `${failing.id}.json`), 'utf8'))
    await writeFile(
      path.join(runs, `${stuckId}.json`),
      JSON.stringify({ ...left, id: stuckId, status: 'thinking', error: null }),
    )
    const restarted = new DecisionWizard({
      dir: path.join(f.root, '.state', 'decisions'),
      thinking: {} as never,
      commands: {} as never,
      notebook: () => null,
      today: async () => new PlainDate('2030-06-18'),
    })
    const seen = await restarted.get(stuckId)
    assert({
      given: 'a run that was thinking when the service stopped',
      should: 'report that it was cut short, so the person can start it again',
      actual: [seen.status, seen.error],
      expected: ['failed', 'Sky was interrupted before it finished thinking. Start it again.'],
    })

    const missing = await f.app.request('/decisions/wizard/not-a-run')
    assert({
      given: 'an address that is not a run',
      should: 'say the wizard does not exist',
      actual: [missing.status, await missing.json()],
      expected: [404, { message: 'That wizard does not exist.' }],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: answers are kept, and only a typed-in option or want sends Sky back to think', async () => {
  const f = await futureFixture()
  try {
    const run = await f.wizard.start({ statement: 'Hire a VP of Sales now, or after the launch', decided: false })
    await f.settled(run.id)
    await f.post(`/decisions/wizard/${run.id}/progress`, {
      answers: { frame: 1, care: 'full', wants: [0, 2] },
      step: 'wants',
    })
    assert({
      given: 'answers saved on the way through',
      should: 'keep them with the step, and list the run under its chosen wording, tied to its open decision',
      actual: [
        await f.wizard.get(run.id).then((session) => [session.answers, session.step]),
        (await f.store.report()).wizards.map((wizard) => ({ ...wizard, open: typeof wizard.open })),
      ],
      expected: [
        [{ frame: 1, care: 'full', wants: [0, 2] }, 'wants'],
        [
          {
            id: run.id,
            title: 'Who leads sales through the October launch',
            status: 'ready',
            decided: false,
            open: 'string',
          },
        ],
      ],
    })

    const adding = await (
      await f.post(`/decisions/wizard/${run.id}/add`, { kind: 'want', text: 'Sleep at night' })
    ).json()
    const withWant = await f.settled(run.id)
    await f.wizard.add(run.id, { kind: 'option', text: 'Split the role between Jane and a contractor' })
    const withOption = await f.settled(run.id)
    const plan = withOption.plan as DecidingPlan
    assert({
      given: 'a want and then an option the person typed in',
      should: 'show Sky working each out, then add it to the plan and to what the person had ticked',
      actual: [
        adding.adding?.kind,
        (withWant.plan as DecidingPlan).wants.at(-1)?.title,
        (withWant.answers as DecidingAnswers).wants,
        plan.options.at(-1)?.title,
        plan.options.at(-1)?.effects.length,
        (withOption.answers as DecidingAnswers).options,
        withOption.adding,
      ],
      expected: [
        'want',
        'Sleep at night',
        [0, 2, 4],
        'Split the role between Jane and a contractor',
        5,
        [0, 1, 2, 3, 4],
        null,
      ],
    })

    await f.wizard.add(run.id, { kind: 'option', text: 'this one will fail' })
    const failed = await f.settled(run.id)
    const dropped = await f.wizard.dropAddition(run.id)
    assert({
      given: 'an addition Sky could not work out',
      should: 'say so, keep the plan as it was, and let the person drop it',
      actual: [failed.adding?.error, (failed.plan as DecidingPlan).options.length, dropped.adding],
      expected: ['Sky could not work that out: The model did not answer.', 5, null],
    })

    await f.wizard.reword(run.id, { text: 'How to cover sales this year' })
    const reworded = await f.settled(run.id)
    assert({
      given: 'the decision put in the person’s own words',
      should: 'think it through again from those words, with the earlier answers cleared',
      actual: [reworded.statement, reworded.answers, f.thought.at(-1)],
      expected: ['How to cover sales this year', {}, { statement: 'How to cover sales this year', decided: false }],
    })

    await f.post(`/decisions/wizard/${run.id}/discard`, {})
    assert({
      given: 'the run discarded',
      should: 'leave nothing unfinished',
      actual: [(await f.store.report()).wizards, (await f.app.request(`/decisions/wizard/${run.id}`)).status],
      expected: [[], 404],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: a decision typed in at the call becomes the call, with the reason the person gave', async () => {
  const f = await futureFixture({ reword: (text) => `Sky’s wording of: ${text}` })
  try {
    const before = await decisionFiles(f.root)
    const run = await f.wizard.start({ statement: 'Hire a VP of Sales now, or after the launch', decided: false })
    await f.settled(run.id)
    const step = (answers: DecidingAnswers, at: string) =>
      f.post(`/decisions/wizard/${run.id}/progress`, { answers, step: at })
    const text = async () =>
      readFile(
        path.join(
          f.root,
          'decisions',
          (await decisionFiles(f.root)).find((name) => !before.includes(name))!,
        ),
        'utf8',
      )
    await step(FULL, 'call')

    await f.wizard.add(run.id, {
      kind: 'option',
      text: 'this one will fail',
      call: true,
      because: 'the launch needs my full attention until then',
    })
    const failed = await f.settled(run.id)
    assert({
      given: 'a decision typed in at the call that Sky could not work out',
      should: 'hold what was typed and the reason, so it can be sent again, and leave the call as it was',
      actual: [
        failed.adding?.error,
        failed.adding?.call,
        failed.adding?.because,
        (failed.answers as DecidingAnswers).call,
      ],
      expected: [
        'Sky could not work that out: The model did not answer.',
        true,
        'the launch needs my full attention until then',
        3,
      ],
    })

    const working = await (
      await f.post(`/decisions/wizard/${run.id}/add`, {
        kind: 'option',
        text: 'Hold the hire until the October launch is out',
        call: true,
        because: 'the launch needs my full attention until then',
      })
    ).json()
    const added = await f.settled(run.id)
    const answers = added.answers as DecidingAnswers
    assert({
      given: 'the same sent again in words Sky can work out',
      should:
        'say it is working, then add the option in the person’s own words, make it the call, and clear the answer Sky gave to the old call',
      actual: [
        working.adding?.error,
        (added.plan as DecidingPlan).options.at(-1)?.title,
        (added.plan as DecidingPlan).options.at(-1)?.short,
        answers.options,
        answers.call,
        answers.final,
        answers.because,
        added.adding,
        added.step,
      ],
      expected: [
        null,
        'Hold the hire until the October launch is out',
        'Sky’s wording of: Hold the hire until the October launch is out',
        [0, 2, 3, 4],
        4,
        undefined,
        { 4: 'the launch needs my full attention until then' },
        null,
        'call',
      ],
    })

    await step(answers, 'answer')
    const open = await text()
    await step(
      {
        ...answers,
        final: 'keep',
        expect: { 4: 'The launch ships in October and the hire starts in November.' },
        sure: 3,
        look: ['2030-12-31'],
      },
      'record',
    )
    await f.post(`/decisions/wizard/${run.id}/save`, {})
    const made = await text()
    assert({
      given: 'the next step, and then the decision saved',
      should: 'write the reason under what is leaned toward while it is open, and under the decision once it is made',
      actual: [
        open.includes(
          '## Leaning toward\n\nHold the hire until the October launch is out.\n\nBecause: the launch needs my full attention until then.',
        ),
        /## Decision\n\nHold the hire until the October launch is out\.[^\n]*\n\nBecause: the launch needs my full attention until then\./.test(
          made,
        ),
      ],
      expected: [true, true],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: "check first" saves an open decision, and finishing later settles that same decision', async () => {
  const f = await futureFixture()
  try {
    const before = await decisionFiles(f.root)
    const run = await f.wizard.start({ statement: 'Hire a VP of Sales now, or after the launch', decided: false })
    await f.settled(run.id)
    const early = await f.post(`/decisions/wizard/${run.id}/save`, {})
    await f.wizard.progress(run.id, {
      answers: {
        frame: 1,
        care: 'full',
        wants: [0, 1],
        top: 0,
        options: [0, 2, 3],
        odds: { 0: 1, 2: 2, 3: 3 },
        hinge: 'check',
        by: '2030-07-01',
        todos: [0, 1, 2],
      },
      step: 'open',
    })
    const opened = await (await f.post(`/decisions/wizard/${run.id}/open`, {})).json()
    const openFile = (await decisionFiles(f.root)).find((file) => !before.includes(file))!
    const openText = await readFile(path.join(f.root, 'decisions', openFile), 'utf8')
    assert({
      given: 'a run with a step left, then saved to check two things first',
      should:
        'refuse the early save, then file an open decision with a day to decide by and add the two checks as to-dos',
      actual: [
        early.status,
        opened.open,
        opened.todos,
        openFile.includes('/pending/'),
        /\ntarget: 2030-07-01\n/.test(openText),
        f.items,
      ],
      expected: [
        409,
        true,
        ['Email Sam Rivera and Priya Shah about July', 'Ask Jane whether she wants to lead the team'],
        true,
        true,
        [
          {
            task: 'Email Sam Rivera and Priya Shah about July',
            list: 'todos',
            when: '2030-06-18',
            category: 'Professional',
          },
          {
            task: 'Ask Jane whether she wants to lead the team',
            list: 'todos',
            when: '2030-06-18',
            category: 'Professional',
          },
        ],
      ],
    })
    assert({
      given: 'the open decision’s file',
      should: 'hold what is wanted, what is being weighed with the odds so far, and what needs checking',
      actual: [
        openText.includes('1. Keep your own time free for the October launch (comes first)'),
        openText.includes('## Options being weighed'),
        openText.includes('Promote Jane Doe to lead sales. My odds for the outcome I want: 60–80%. Sky’s: 40–60%.'),
        openText.includes('- Jane wants to lead the team. To check: One conversation.'),
        openText.includes('  - goals/Run-a-Marathon'),
      ],
      expected: [true, true, true, true, true],
    })
    const report = await f.store.report()
    assert({
      given: 'the Decisions list straight after',
      should: 'show the open decision, tied to the run that can finish it',
      actual: [
        report.decisions
          .filter((decision) => decision.title === 'Who leads sales through the October launch')
          .map((decision) => [decision.state, decision.target]),
        report.wizards.map((wizard) => wizard.open === opened.name),
      ],
      expected: [[['open', '2030-07-01']], [true]],
    })
    const parked = await f.wizard.get(run.id)
    assert({
      given: 'the run after it was saved as open',
      should:
        'wait at the call, with the checks marked as set aside, so coming back does not ask to save it as open again',
      actual: [(parked.answers as { hinge?: string }).hinge, parked.step, f.filed],
      expected: ['checked', 'call', [[run.id, opened.name]]],
    })
    const page = await (await f.app.request(`/decision/${opened.name}`)).json()
    assert({
      given: 'the open decision’s own page',
      should: 'give its record from the file, and how its options stand from the run still open on it',
      actual: [
        [page.decision.title, page.decision.state, page.decision.target],
        page.decision.sections.map((section: { heading: string }) => section.heading),
        [page.weighing.run === run.id, page.weighing.plan.options.length, page.weighing.answers.options],
        (await (await f.app.request('/decision/Hire-a-Coach')).json()).weighing,
        (await f.app.request('/decision/No-Such-Decision')).status,
      ],
      expected: [
        ['Who leads sales through the October launch', 'open', '2030-07-01'],
        ['Desired Outcomes', 'Options being weighed', 'What it rests on'],
        [true, 4, [0, 2, 3]],
        null,
        404,
      ],
    })
    const talking = await (await f.app.request(`/decisions/wizard/${run.id}/chat`)).json()
    f.filedChats.set(run.id, 'time/2030/W25/06-18/actions/ai-chats/09-00_Who-signs-first.md')
    const filedChat = await (await f.app.request(`/decisions/wizard/${run.id}/chat`)).json()
    assert({
      given: 'where to talk the decision through, before and after its chat was closed and filed',
      should: 'name the chat’s own thread, and then also the file to reopen it from',
      actual: [talking, filedChat, (await f.app.request('/decisions/wizard/not-a-run/chat')).status],
      expected: [
        { thread: `decision-${run.id}`, filed: null },
        { thread: `decision-${run.id}`, filed: 'time/2030/W25/06-18/actions/ai-chats/09-00_Who-signs-first.md' },
        404,
      ],
    })

    await f.wizard.progress(run.id, { answers: { ...FULL, force: true }, step: 'record' })
    const saved = await (await f.post(`/decisions/wizard/${run.id}/save`, {})).json()
    const files = await decisionFiles(f.root)
    const madeFile = files.find((file) => file.includes('/in-force/') && file.endsWith(`${opened.name}.md`))!
    const made = await readFile(path.join(f.root, 'decisions', madeFile), 'utf8')
    assert({
      given: 'the call made later, and marked as staying in force',
      should: 'put the made decision in place of the open one, with reminders to look back, and end the run',
      actual: [
        [saved.name === opened.name, saved.open, saved.inForce, saved.look],
        f.filed.map(([id, name]) => [id === run.id, name === opened.name]),
        files.some((file) => file === openFile),
        f.items.slice(2),
        (await f.store.report()).wizards,
        await exists(path.join(f.root, '.state', 'decisions', 'runs', `${run.id}.json`)),
        // The run is gone; what was weighed stays with the decision, for its page.
        await f.wizard.weighing(opened.name).then((kept) => [kept?.run, kept?.plan.options.length, kept?.answers.call]),
      ],
      expected: [
        [true, false, true, ['2030-09-01', '2030-12-31']],
        // Once when it was saved as open, and again when the call was made.
        [
          [true, true],
          [true, true],
        ],
        false,
        [
          {
            task: 'Look back on “Who leads sales through the October launch”: did it go the way you expected?',
            list: 'reminders',
            when: '2030-09-01',
            category: 'Professional',
          },
          {
            task: 'Look back on “Who leads sales through the October launch”: did it go the way you expected?',
            list: 'reminders',
            when: '2030-12-31',
            category: 'Professional',
          },
        ],
        [],
        false,
        [null, 4, FULL.call],
      ],
    })
    assert({
      given: 'the made decision’s file',
      should: 'carry the call, Sky’s own choice, the full record, and the references that still resolve',
      actual: [
        made.includes('\ninForce: true\n'),
        made.includes(
          '## Decision\n\nPromote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
        ),
        made.includes('## Options weighed') && !made.includes('Options being weighed'),
        made.includes(
          '## What I expect\n\nBy Dec 31, $1.8M in new bookings.\n\nHow sure: 60–80%. Look back: 2030-09-01 and 2030-12-31.',
        ),
        made.includes('## Rules set ahead of time\n\n- Review it on Dec 31.'),
        ['goals/Run-a-Marathon', 'goals/Learn-Spanish', 'decisions/No-Late-Nights'].map((ref) =>
          made.includes(`  - ${ref}`),
        ),
      ],
      expected: [true, true, true, true, true, [true, true, true]],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: a decision already made is filed on the day it was made', async () => {
  const f = await futureFixture()
  try {
    const plan = sampleDecidedPlan()
    const run = await f.wizard.start({
      statement: 'No senior hires before the Series B closes',
      why: 'You told the leadership meeting.',
      decided: true,
    })
    await f.settled(run.id)
    const answers: DecidedAnswers = {
      wording: plan.wordings[1]!.title,
      when: '2030-03-12',
      knew: plan.knew.map((item) => item.text),
      wants: plan.wants.map((want) => want.title),
      others: [plan.others[0]!.title],
      force: 'until',
      until: 'the Series B closes',
      expect: plan.expect[0]!.text,
      sure: 3,
      look: ['2030-09-30', 'someday'],
    }
    await f.wizard.progress(run.id, { answers, step: 'record' })
    const saved = await f.wizard.save(run.id)
    assert({
      given: 'a rule made in March and written down in June, with one reminder that cannot be set',
      should: 'date it in March, keep it in force, set the reminder that can be set, and say which could not',
      actual: [saved.when, saved.inForce, saved.look, saved.warnings, f.created.at(-1)?.when, f.created.at(-1)?.rel],
      expected: [
        '2030-03-12',
        true,
        ['2030-09-30'],
        ['The reminder for someday was not set: That is not a day.'],
        '2030-03-12',
        ['goals/Learn-Spanish'],
      ],
    })
    const file = (await decisionFiles(f.root)).find(
      (name) => name.includes('/in-force/03/') && name.endsWith(`${saved.name}.md`),
    )!
    const text = await readFile(path.join(f.root, 'decisions', file), 'utf8')
    assert({
      given: 'its file',
      should: 'say what ends it, and keep what was learned since apart from what was known that day',
      actual: [
        text.includes('It holds until the Series B closes.'),
        text.indexOf('## What I knew that day') < text.indexOf('## Learned since'),
        text.includes('- The round slipped from July to the third quarter. (Investor update, Jun 6)'),
      ],
      expected: [true, true, true],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: the notebook is searched for decisions once a day, and what is already written down is left out', async () => {
  const f = await futureFixture()
  try {
    const looking = await (await f.app.request('/decisions/finds')).json()
    let found = looking
    for (let tries = 0; tries < 100 && found.status === 'looking'; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      found = await (await f.app.request('/decisions/finds')).json()
    }
    assert({
      given: 'the first look of the day, in a notebook that already has "Which race to enter" written down',
      should: 'say it is looking, then offer what it found, leaving the one already written down out',
      actual: [
        looking.status,
        found.status,
        found.finds.map((find: { title: string; decided: boolean }) => [find.title, find.decided]),
      ],
      expected: [
        'looking',
        'ready',
        [
          ['Hire a VP of Sales now, or after the October launch', false],
          ['No senior hires before the Series B closes', true],
        ],
      ],
    })
    const run = await f.wizard.start({ statement: 'No senior hires before the Series B closes', decided: true })
    await f.settled(run.id)
    await f.wizard.progress(run.id, {
      answers: { wording: 'No senior hires before the Series B closes' },
      step: 'wording',
    })
    assert({
      given: 'a find the person has started on',
      should: 'stop offering it',
      actual: (await f.wizard.finds([])).finds.map((find) => find.title),
      expected: ['Hire a VP of Sales now, or after the October launch', 'Which race to enter'],
    })
  } finally {
    await f.dispose()
  }
})

test('decision wizard: the decision is in the notebook as open once past the first step, and kept in step', async () => {
  const f = await futureFixture()
  try {
    const before = await decisionFiles(f.root)
    const run = await f.wizard.start({ statement: 'Hire a VP of Sales now, or after the launch', decided: false })
    await f.settled(run.id)
    const step = (answers: DecidingAnswers, at: string, now?: boolean) =>
      f.post(`/decisions/wizard/${run.id}/progress`, { answers, step: at, ...(now ? { now } : {}) })
    const file = async () => (await decisionFiles(f.root)).find((name) => !before.includes(name))
    const text = async () => readFile(path.join(f.root, 'decisions', (await file())!), 'utf8')

    await step({ frame: 1 }, 'frame')
    const atFirst = await file()
    await step({ frame: 1 }, 'care')
    const created = await text()
    const filed = (await f.wizard.get(run.id)).open
    assert({
      given: 'a wording picked on the first step, then the move to the second',
      should:
        'write nothing while on the first step, then file an open decision under the chosen wording, without opening the editor, and say so to whoever ties a chat to it',
      actual: [
        atFirst,
        (await file())?.includes('/pending/'),
        f.created.map((made) => [made.title, made.noEditor, made.decision]),
        created.includes('summary: Who leads sales through the October launch'),
        created.includes('## Options being weighed\n\n- Hire a VP of Sales now.\n- Wait until after the launch.'),
        f.filed,
        (await f.store.report()).decisions.filter((decision) => decision.name === filed).map((d) => d.state),
      ],
      expected: [
        undefined,
        true,
        [['Who leads sales through the October launch', true, undefined]],
        true,
        true,
        [[run.id, filed]],
        ['open'],
      ],
    })

    const picked: DecidingAnswers = {
      frame: 1,
      care: 'full',
      wants: [0, 3],
      top: 3,
      options: [2, 3],
      odds: { 2: 2, 3: 3 },
    }
    await step(picked, 'wants')
    await step({ ...picked, hinge: 'now', call: 3 }, 'wants')
    const sameStep = await text()
    await step({ ...picked, hinge: 'now', call: 3, final: 'keep' }, 'wants', true)
    const leaving = await text()
    await step(
      { ...picked, hinge: 'now', call: 3, final: 'keep', expect: { 3: 'By Dec 31 Jane runs the team.' } },
      'sure',
    )
    const later = await text()
    assert({
      given: 'more answers on one step, then leaving the page, then a later step',
      should:
        'rewrite the file when the step changes or the person leaves, not on every answer, and carry what is wanted, the odds, the leaning and what is expected',
      actual: [
        sameStep.includes('1. Keep Jane Doe, your top account executive (comes first)\n2. Keep your own time free'),
        sameStep.includes('Leaning toward'),
        leaving.includes(
          '## Leaning toward\n\nPromote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
        ),
        later.includes('## What I expect\n\nBy Dec 31 Jane runs the team.'),
        later.includes('- Promote Jane Doe to lead sales. My odds for the outcome I want: 60–80%. Sky’s: 40–60%.'),
        later.includes('## Decision\n\n\n\n## Outcome'),
        f.updated.length,
        (await file())?.includes('/pending/'),
      ],
      expected: [true, false, true, true, true, true, 3, true],
    })

    await writeFile(path.join(f.root, 'decisions', (await file())!), `${later}\nMy own note.\n`)
    await step({ ...picked, hinge: 'now', call: 2, final: 'keep' }, 'record')
    const mine = await text()
    await step({ ...picked, hinge: 'now', call: 2, final: 'keep' }, 'rules')
    assert({
      given: 'the file changed by hand, then two more steps',
      should: 'leave the person’s file as they wrote it from then on',
      actual: [
        mine.endsWith('My own note.\n'),
        mine.includes('Leaning toward\n\nPromote Jane'),
        (await text()) === mine,
      ],
      expected: [true, true, true],
    })
  } finally {
    await f.dispose()
  }
})
