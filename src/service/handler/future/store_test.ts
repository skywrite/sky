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
        chart: [goal.number?.from, goal.number?.todayDay, goal.number?.dueDay, goal.number?.days],
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
        [404, { message: '"Run-a-10k" is not one of your active goals. It may have been renamed or archived.' }],
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
