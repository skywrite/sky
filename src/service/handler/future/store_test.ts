import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { futureFixture } from './testHelpers.ts'

test('Future: a goal with a number shows where it stands and everything tied to it', async () => {
  const f = await futureFixture()
  try {
    const report = await f.store.report()
    const goal = report.goals.find((item) => item.name === 'Run-a-Marathon')!
    assert({
      given: 'three active goals, one of them serving another, and an archived goal',
      should: 'list the active ones, those that stand on their own first',
      actual: report.goals.map((item) => item.name),
      expected: ['Learn-Spanish', 'Run-a-Marathon', 'Weekly-Long-Runs'],
    })
    assert({
      given: 'a goal that follows a tracker from the day work began',
      should: 'say where it started, where it is, how far it has to go and how long is left',
      actual: {
        first: goal.number?.first?.text,
        latest: goal.number?.latest?.text,
        moved: goal.number?.movedText,
        toGo: goal.number?.toGoText,
        target: goal.number?.targetText,
        progress: goal.number?.progress?.toFixed(3),
        reached: goal.number?.reached,
        daysLeft: goal.daysLeft,
        chart: [goal.number?.from, goal.number?.endDay, goal.number?.dueDay, goal.number?.days],
        days: goal.number?.points.map((point) => point.day),
      },
      expected: {
        first: '6 mi',
        latest: '14 mi',
        moved: '+8 mi',
        toGo: '12.2 mi',
        target: '26.2 mi',
        progress: '0.396',
        reached: false,
        daysLeft: 108,
        chart: ['2030-05-01', 48, 156, 156],
        days: [0, 19, 47],
      },
    })
    assert({
      given: 'checkpoints before and after today',
      should: 'mark a past one by the number on its date, and a coming one as still ahead',
      actual: goal.checkpoints.map((checkpoint) => `${checkpoint.text} by ${checkpoint.date}: ${checkpoint.state}`),
      expected: ['10 mi by 2030-06-01: reached', '20 mi by 2030-06-10: missed', '22 mi by 2030-09-01: ahead'],
    })
    assert({
      given: 'a decision in force, an open one, a made one, an idea, a habit and a smaller goal that name the goal',
      should: 'tie each to the goal, whatever the capitals in the reference',
      actual: {
        inForce: goal.inForce.map((tie) => `${tie.title} (${tie.since})`),
        toDecide: goal.toDecide.map((tie) => tie.title),
        decided: goal.decided.map((tie) => tie.file),
        ideas: goal.ideas.map((tie) => `${tie.title}: ${tie.status}`),
        habits: goal.habits.map((tie) => tie.name),
        smaller: goal.smaller.map((tie) => tie.title),
        serves: report.goals.find((item) => item.name === 'Weekly-Long-Runs')?.serves,
      },
      expected: {
        inForce: ['No late nights before a long run (2030-03-02)'],
        toDecide: ['Which race to enter'],
        decided: ['decisions/2030/resolved/03/Hire-a-Coach.md'],
        ideas: ['Join a running club: draft'],
        habits: ['run-before-work'],
        smaller: ['A long run every week'],
        serves: { name: 'Run-a-Marathon', title: 'Run a marathon' },
      },
    })
    assert({
      given: 'a decision in force that names two goals',
      should: 'list it once across the goals, with both',
      actual: report.inForce.map((item) => [item.title, item.goals.map((tie) => tie.name)]),
      expected: [['No late nights before a long run', ['Learn-Spanish', 'Run-a-Marathon']]],
    })
    assert({
      given: 'a goal whose writing holds Markdown and pasted HTML',
      should: 'render the Markdown and show the HTML as text',
      actual: goal.bodyHtml.trim(),
      expected: '<p>Finish one <strong>this year</strong>. &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    })
    const spanish = report.goals.find((item) => item.name === 'Learn-Spanish')!
    assert({
      given: 'a goal that follows a tracker that is not there',
      should: 'show no number and say why',
      actual: [spanish.number, spanish.numberProblem],
      expected: [null, 'This goal follows "vocabulary", which is not in Tracking any more.'],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: a new goal is one file named after it, and a second by the same name never replaces the first', async () => {
  const f = await futureFixture()
  try {
    const first = await f.post('/goals', {
      title: 'Read 20 books',
      category: 'Professional',
      why: 'Read more.',
      due: '2030-12-31',
    })
    const second = await f.post('/goals', { title: 'read 20 Books', category: 'Personal' })
    assert({
      given: 'two goals whose names differ only in capitals',
      should: 'create both, the second under a numbered name',
      actual: [first.status, await first.json(), second.status, await second.json()],
      expected: [201, { name: 'Read-20-books' }, 201, { name: 'read-20-Books-2' }],
    })
    assert({
      given: 'the first goal',
      should: 'write its title, category, date and the day it was written, then its reason',
      actual: await f.goalFile('Read-20-books'),
      expected:
        '---\ntitle: Read 20 books\ncategory: Professional\ndue: 2030-12-31\ncreated: 2030-06-18\nupdated: 2030-06-18\n---\n\n# Read 20 books\n\nRead more.\n',
    })
    assert({
      given: 'the page reading again straight after',
      should: 'show the new goals without waiting for the notebook to be read again',
      actual: (await f.store.report()).goals.map((goal) => goal.title).filter((title) => /books/i.test(title)),
      expected: ['read 20 Books', 'Read 20 books'],
    })
    const blank = await f.post('/goals', { title: '   ', category: 'Personal' })
    assert({
      given: 'a goal with no name',
      should: 'refuse it and say what is missing',
      actual: [blank.status, await blank.json()],
      expected: [400, { message: 'Say what the goal is.' }],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: connecting a number and adding checkpoints change only those lines of the goal file', async () => {
  const f = await futureFixture()
  try {
    const connected = await f.post('/goals/learn-spanish/number', {
      track: 'long-run',
      target: 30,
      due: '2030-11-01',
      start: '2030-06-01',
    })
    await f.post('/goals/Learn-Spanish/checkpoints', { value: 20, date: '2030-09-01' })
    await f.post('/goals/Learn-Spanish/checkpoints', { value: 12, date: '2030-07-01' })
    await f.post('/goals/Learn-Spanish/checkpoints', { value: 21, date: '2030-09-01' })
    assert({
      given: 'a number connected, then three checkpoints, two on the same date',
      should: 'write the number, its target and dates, and keep one checkpoint per date, oldest first',
      actual: [connected.status, await f.goalFile('Learn-Spanish')],
      expected: [
        200,
        '---\ntitle: Learn Spanish\ncategory: Personal\nstart: 2030-06-01\ndue: 2030-11-01\ntrack: long-run\ntarget: 30\ncheckpoints:\n  - 12 by 2030-07-01\n  - 21 by 2030-09-01\nupdated: 2030-06-18\n---\n\n# Learn Spanish\n',
      ],
    })
    await f.post('/goals/Learn-Spanish/checkpoints/remove', { date: '2030-07-01' })
    await f.post('/goals/Learn-Spanish/checkpoints/remove', { date: '2030-09-01' })
    await f.post('/goals/Learn-Spanish/number', { track: 'long-run', target: 30 })
    assert({
      given: 'both checkpoints removed and the number saved again without dates',
      should: 'take the empty list and the dates out of the file',
      actual: await f.goalFile('Learn-Spanish'),
      expected:
        '---\ntitle: Learn Spanish\ncategory: Personal\ntrack: long-run\ntarget: 30\nupdated: 2030-06-18\n---\n\n# Learn Spanish\n',
    })
    const unknown = await f.post('/goals/Learn-Spanish/number', { track: 'vocabulary', target: 2000 })
    const later = await f.post('/goals/Learn-Spanish/number', { track: 'long-run', target: 30, start: '2030-07-01' })
    const archived = await f.post('/goals/Run-a-10k/number', { track: 'long-run', target: 6.2 })
    assert({
      given: 'a tracker that is not there, a start that has not happened, and a goal that is archived',
      should: 'refuse each one and say what is wrong',
      actual: [
        [unknown.status, await unknown.json()],
        [later.status, await later.json()],
        [archived.status, await archived.json()],
      ],
      expected: [
        [400, { message: '"vocabulary" is not a number in Tracking. Choose one from the list.' }],
        [400, { message: 'The start is a day that has already happened.' }],
        [404, { message: '"Run-a-10k" is not one of your active goals. It may have been renamed or closed.' }],
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: a change from another site, or one sent before the notebook is read, is refused', async () => {
  const f = await futureFixture({ ready: false })
  try {
    const crossSite = await f.post(
      '/goals',
      { title: 'Learn to sail', category: 'Personal' },
      { 'sec-fetch-site': 'cross-site' },
    )
    const early = await f.app.request('/report')
    assert({
      given: 'a request from another site, and a read before the notebook has loaded',
      should: 'turn the first away and ask the second to try again',
      actual: [crossSite.status, early.status, await early.json()],
      expected: [403, 503, { message: 'Sky is still reading your notebook. Try again in a moment.' }],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: closing a goal files it under how it ended, with the day and where its number stood', async () => {
  const f = await futureFixture()
  try {
    const before = await f.store.report()
    assert({
      given: 'a goal reached last year and one archived before endings were recorded',
      should: 'list the reached one among past goals, and leave the older one out',
      actual: before.past,
      expected: [
        {
          name: 'Run-a-5k',
          title: 'Run a 5k',
          category: 'Personal',
          status: 'reached',
          ended: '2029-09-01',
          final: '3.1 mi',
        },
      ],
    })

    const tomorrow = await f.post('/goals/Run-a-Marathon/close', { ending: 'missed', ended: '2030-06-19' })
    const unsaid = await f.post('/goals/Run-a-Marathon/close', {})
    assert({
      given: 'a close dated tomorrow, and one that does not say how the goal ended',
      should: 'refuse both and leave the goal where it is',
      actual: [
        [tomorrow.status, await tomorrow.json()],
        [unsaid.status, await unsaid.json()],
        (await f.store.report()).goals.some((goal) => goal.name === 'Run-a-Marathon'),
      ],
      expected: [
        [400, { message: 'A goal ends on a day that has already happened.' }],
        [400, { message: 'Say how the goal ended.' }],
        true,
      ],
    })

    const closed = await f.post('/goals/run-a-marathon/close', {
      ending: 'missed',
      ended: '2030-06-01',
      note: 'An injury in May cost the summer.',
    })
    const file = await f.goalFile('Run-a-Marathon', 'missed/2030')
    assert({
      given: 'the goal closed as missed on an earlier day, with a line about it',
      should: 'move the file under that ending and year, and record the day, the reading on that day, and the line',
      actual: [
        closed.status,
        file.match(/\nended: .*\nfinal: .*\n/)?.[0],
        file.endsWith('\n\n## How it ended\n\nAn injury in May cost the summer.\n'),
        await f.goalFile('Run-a-Marathon').catch(() => 'gone'),
      ],
      expected: [200, '\nended: 2030-06-01\nfinal: 10 mi\n', true, 'gone'],
    })

    const after = await f.store.report()
    const view = await (await f.app.request('/goals/Run-a-Marathon')).json()
    assert({
      given: 'the notebook read again straight after',
      should: 'show the goal among past goals, off the active ones, and off the decision in force',
      actual: [
        after.past.map((goal) => `${goal.name}: ${goal.status} ${goal.ended} at ${goal.final}`),
        after.goals.map((goal) => goal.name),
        after.inForce[0]?.goals.map((goal) => goal.name),
      ],
      expected: [
        ['Run-a-Marathon: missed 2030-06-01 at 10 mi', 'Run-a-5k: reached 2029-09-01 at 3.1 mi'],
        ['Learn-Spanish', 'Weekly-Long-Runs'],
        ['Learn-Spanish'],
      ],
    })
    assert({
      given: "the closed goal's own page",
      should: 'read its number through the day it ended, with nothing left to count down and no checkpoint after it',
      actual: [
        view.goal.status,
        view.goal.number.through,
        view.goal.number.latest.text,
        view.goal.daysLeft,
        view.goal.checkpoints.map((checkpoint: { state: string }) => checkpoint.state),
      ],
      expected: ['missed', '2030-06-01', '10 mi', null, ['reached']],
    })

    const again = await f.post('/goals/Run-a-Marathon/close', { ending: 'dropped' })
    const edited = await f.post('/goals/Run-a-Marathon/date', { due: '2031-01-01' })
    assert({
      given: 'a second close and a new date for a goal that has ended',
      should: 'refuse both: an ended goal changes only by being reopened',
      actual: [again.status, edited.status],
      expected: [404, 404],
    })

    const reopened = await f.post('/goals/Run-a-Marathon/reopen', {})
    const back = await f.goalFile('Run-a-Marathon')
    assert({
      given: 'the goal reopened',
      should: 'move it back among the active goals without its ending, keeping what was written about it',
      actual: [
        reopened.status,
        /\n(ended|final): /.test(back),
        back.includes('An injury in May cost the summer.'),
        (await f.store.report()).goals.map((goal) => goal.name),
        (await f.post('/goals/Run-a-Marathon/reopen', {})).status,
      ],
      expected: [200, false, true, ['Learn-Spanish', 'Run-a-Marathon', 'Weekly-Long-Runs'], 404],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: a goal takes a new date, loses its date, and closes without a number', async () => {
  const f = await futureFixture()
  try {
    await f.post('/goals/Weekly-Long-Runs/date', { due: '2030-09-30' })
    const dated = await f.goalFile('Weekly-Long-Runs')
    await f.post('/goals/Weekly-Long-Runs/date', { due: null })
    const undated = await f.goalFile('Weekly-Long-Runs')
    assert({
      given: 'a goal given a date, then asked to have none',
      should: 'write the date, then take the line out',
      actual: [/\ndue: 2030-09-30\n/.test(dated), /\ndue: /.test(undated)],
      expected: [true, false],
    })

    await f.post('/goals/Weekly-Long-Runs/close', { ending: 'dropped' })
    const file = await f.goalFile('Weekly-Long-Runs', 'dropped/2030')
    assert({
      given: 'a goal with no number dropped today',
      should: 'file it under dropped for this year, with the day and no reading',
      actual: [/\nended: 2030-06-18\n/.test(file), /\nfinal: /.test(file)],
      expected: [true, false],
    })
  } finally {
    await f.dispose()
  }
})

test('Future: decisions are listed by where they stand, with the goals they weigh on', async () => {
  const f = await futureFixture()
  try {
    assert({
      given: 'an open decision, one in force and one made',
      should: 'list the open one first, then the one in force, then the one made, each with the goals it weighs on',
      actual: (await f.store.report()).decisions.map(
        (decision) => `${decision.state}: ${decision.title} [${decision.goals.map((goal) => goal.name).join(', ')}]`,
      ),
      expected: [
        'open: Which race to enter [Run-a-Marathon]',
        'inForce: No late nights before a long run [Learn-Spanish, Run-a-Marathon]',
        'decided: Hire a coach [Run-a-Marathon]',
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('FutureStore.decision gives a decision’s page: where it stands, its record by section, and what it is tied to', async () => {
  const f = await futureFixture()
  try {
    await f.tracking.put(
      'decisions/2030/pending/03/Which-Race.md',
      [
        '---',
        'name: Which-Race',
        'summary: Which race to enter',
        'identified: 2030-03-02T09:00:00-06:00[America/Chicago]',
        'target: 2030-07-01',
        'rel:',
        '  - goals/Run-a-Marathon',
        '  - decisions/No-Late-Nights',
        '---',
        '',
        '# Which race to enter',
        '',
        'Two races fit the plan. <b>One</b> is in October.',
        '',
        '## Desired Outcomes',
        '',
        '1. A full marathon (comes first)',
        '2. A course without hills',
        '',
        '## Options being weighed',
        '',
        '- The city marathon. My odds for the outcome I want: 40–60%.',
        '',
        '## Decision',
        '',
        '',
        '',
        '## Outcome',
        '',
      ].join('\n'),
    )
    const notebook = f.store.notebook()!
    notebook.decisions.set(
      path.join(f.root, 'decisions/2030/pending/03/Which-Race.md'),
      await readFile(path.join(f.root, 'decisions/2030/pending/03/Which-Race.md'), 'utf8'),
    )
    const { decision, today } = await f.store.decision('which-race')
    let missing = ''
    try {
      await f.store.decision('No-Such-Decision')
    } catch (error) {
      missing = (error as Error).message
    }
    assert({
      given:
        'an open decision with a day to decide by, a record of two sections, a goal and another decision in its rel',
      should:
        'find it whatever the case, give the situation and each written section as safe HTML, leave empty sections out, and name the goal and the decision it is tied to',
      actual: [
        [today, decision.name, decision.title, decision.state, decision.target, decision.since],
        decision.contextHtml.trim(),
        decision.sections.map((section) => section.heading),
        decision.sections[0]?.html.includes('<li>A full marathon (comes first)</li>'),
        decision.goals,
        decision.decisions.map((other) => [other.name, other.state]),
        missing,
      ],
      expected: [
        ['2030-06-18', 'Which-Race', 'Which race to enter', 'open', '2030-07-01', '2030-03-02'],
        '<p>Two races fit the plan. &lt;b&gt;One&lt;/b&gt; is in October.</p>',
        ['Desired Outcomes', 'Options being weighed'],
        true,
        [{ name: 'Run-a-Marathon', title: 'Run a marathon' }],
        [['No-Late-Nights', 'inForce']],
        '"No-Such-Decision" is not one of your decisions. It may have been renamed.',
      ],
    })
  } finally {
    await f.dispose()
  }
})
