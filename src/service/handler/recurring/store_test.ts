import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import extractDayItems from '#commands/all/day/_extractDayItems.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createRecurringRoutes } from './mod.ts'
import { RecurringStore, recurringDates } from './store.ts'
import type { RecurringDraft, RecurringReport, RecurringSource } from './types.ts'

const TODAY = new PlainDate('2031-03-17')
const draft: RecurringDraft = {
  text: 'Review Atlas',
  notes: '',
  kind: 'todo',
  category: 'Professional',
  time: '',
  pattern: 'EVERY-DAY',
}
const revisions = (report: RecurringReport) =>
  Object.fromEntries(report.files.map((file) => [file.source, file.revision]))

async function fixture(
  run: (f: {
    root: string
    store: RecurringStore
    put: (source: RecurringSource, content: string) => Promise<void>
    read: (source: RecurringSource) => Promise<string>
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-recurring-test-'))
  const timeDir = path.join(root, 'time')
  const file = (source: RecurringSource) =>
    path.join(timeDir, source === 'reminders' ? 'reminders.md' : 'recurring-' + source + '.md')
  const store = new RecurringStore({ notebookDir: root, timeDir, stateDir: path.join(root, '.state') }, () => TODAY)
  try {
    await run({
      root,
      store,
      put: async (source, content) => {
        await mkdir(timeDir, { recursive: true })
        await writeFile(file(source), content)
      },
      read: (source) => readFile(file(source), 'utf8'),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('recurring report is read-only for an empty notebook and creation uses the CLI grammar', async () => {
  await fixture(async (f) => {
    const report = await f.store.report()
    assert({
      given: 'a notebook with no recurring files',
      should: 'show empty sources without creating files or state',
      actual: [report.today, report.items, report.files.map((file) => file.exists), await readdir(f.root)],
      expected: [TODAY.ymd, [], [false, false, false], []],
    })
    const saved = await f.store.save({ draft, revisions: revisions(report) })
    assert({
      given: 'the first recurring to-do',
      should: 'create a source the existing day extractor consumes',
      actual: [
        saved.items.map((item) => [item.text, item.kind]),
        extractDayItems(ListDocument.fromMarkdown(await f.read('professional')), TODAY),
        (await readdir(path.join(f.root, 'time'))).sort(),
      ],
      expected: [
        [['Review Atlas', 'todo']],
        ['Review Atlas'],
        ['recurring-personal.md', 'recurring-professional.md', 'reminders.md'],
      ],
    })
  })
})

test('recurring reports keep legacy schedules, notes, duplicates and invalid headings visible', async () => {
  await fixture(async (f) => {
    await f.put(
      'personal',
      '# Personal\n\n## Monday\n- 25:30 > Call Jane Doe\n  Keep the attached note.\n  - A nested step\n- Plan meals\n- Plan meals\n\n## EVERY-MONDAY\n- Fix this schedule\n\n## Notes\nA paragraph before the list.\n- Documentation example\n\n~~~md\n## EVERY-DAY\n- Fenced example\n~~~\n',
    )
    const report = await f.store.report()
    assert({
      given: 'legacy tokens, an extended time, nested notes, duplicate titles and documentation',
      should: 'read actual extractor lists, preserve individual addresses and explain invalid schedules',
      actual: [
        report.items.map((item) => [item.text, item.kind, item.valid]),
        report.items[0].notes,
        report.items[0].dates,
        report.items[1].id !== report.items[2].id,
      ],
      expected: [
        [
          ['Call Jane Doe', 'commitment', true],
          ['Plan meals', 'todo', true],
          ['Plan meals', 'todo', true],
          ['Fix this schedule', 'todo', false],
        ],
        'Keep the attached note.\n- A nested step',
        ['2031-03-17', '2031-03-24', '2031-03-31'],
        true,
      ],
    })
  })
})

test('editing one recurring copy preserves frontmatter, prose, notes, links and its legacy heading', async () => {
  await fixture(async (f) => {
    const original =
      '---\ntitle: Personal\ncustom: keep-this\n---\n\n# Routines\n\nKeep this introduction.\n\n## Monday\n\n* Review Atlas\n  With [notes][plan].\n* Review Atlas\n  Second copy.\n\nA closing paragraph.\n\n[plan]: ../projects/Atlas/plan.md\n'
    await f.put('personal', original)
    const report = await f.store.report()
    const item = report.items[1]
    const saved = await f.store.save({
      id: item.id,
      revisions: revisions(report),
      draft: { ...item, text: 'Review Widget', pattern: 'EVERY-MON' },
    })
    assert({
      given: 'two copies and a title edit to the second',
      should: 'patch just its title and preserve the legacy heading and surrounding bytes',
      actual: [await f.read('personal'), saved.items.map((value) => value.text)],
      expected: [
        original.replace('* Review Atlas\n  Second copy.', '* Review Widget\n  Second copy.'),
        ['Review Atlas', 'Review Widget'],
      ],
    })
  })
})

test('moving a recurring item changes only definitions and carries notes and resolved links', async () => {
  await fixture(async (f) => {
    await f.put(
      'professional',
      '# Work\n\n## EVERY-DAY\n- Review [Atlas][plan]\n  - Keep the notes.\n\n[plan]: ../projects/Atlas/plan.md\n',
    )
    await f.put('reminders', '# Reminders\n\n## EVERY-DAY\n- Water plants\n\nA closing paragraph.\n')
    const day = path.join(f.root, 'prepared-day.md')
    const dailyCopy = '# A prepared day\n\n## Professional Todos\n- Review [Atlas][plan]\n'
    await writeFile(day, dailyCopy)
    const report = await f.store.report()
    const item = report.items[0]
    const moved = await f.store.save({
      id: item.id,
      revisions: revisions(report),
      draft: { ...item, kind: 'reminder' },
    })
    const reminders = await f.read('reminders')
    assert({
      given: 'a task moved into reminders, with notes and a reference link',
      should: 'resolve its links, append inside the recognized list and preserve already prepared copies',
      actual: [
        moved.items.map((value) => [value.source, value.text]),
        reminders.includes('  - Keep the notes.'),
        reminders.includes('\n\nA closing paragraph.\n'),
        await readFile(day, 'utf8'),
        extractDayItems(ListDocument.fromMarkdown(reminders), TODAY).length,
      ],
      expected: [
        [
          ['reminders', 'Water plants'],
          ['reminders', 'Review [Atlas](../projects/Atlas/plan.md)'],
        ],
        true,
        true,
        dailyCopy,
        2,
      ],
    })
    const removed = await f.store.remove({ id: moved.items[1].id, revisions: revisions(moved) })
    assert({
      given: 'Stop repeating for the moved definition',
      should: 'remove only that definition and leave its daily copy intact',
      actual: [removed.items.map((value) => value.text), await readFile(day, 'utf8')],
      expected: [['Water plants'], dailyCopy],
    })
  })
})

test('the last removed recurring item leaves a usable list and can be replaced', async () => {
  await fixture(async (f) => {
    const first = await f.store.save({ draft, revisions: revisions(await f.store.report()) })
    const empty = await f.store.remove({ id: first.items[0].id, revisions: revisions(first) })
    const next = await f.store.save({ draft: { ...draft, text: 'A replacement routine' }, revisions: revisions(empty) })
    assert({
      given: 'the only definition stopped and a replacement added to its schedule',
      should: 'keep the source usable by day start',
      actual: [
        next.items.map((item) => item.text),
        extractDayItems(ListDocument.fromMarkdown(await f.read('professional')), TODAY),
      ],
      expected: [['A replacement routine'], ['A replacement routine']],
    })
  })
})

test('stale and concurrent writes cannot replace newer recurring data', async () => {
  await fixture(async (f) => {
    await f.put('professional', '# Routines\n\n## EVERY-DAY\n- Review Atlas\n')
    const report = await f.store.report()
    const edited = '# Routines\n\n## EVERY-DAY\n- Review Atlas\n  A later note.\n'
    await f.put('professional', edited)
    const app = createRecurringRoutes(f.store)
    const post = (body: unknown) =>
      app.request('http://localhost/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const stale = await post({
      id: report.items[0].id,
      revisions: revisions(report),
      draft: { ...draft, text: 'My unsaved edit' },
    })
    assert({
      given: 'the source changed after an editor opened',
      should: 'refuse the stale edit with context and preserve the later note',
      actual: [
        stale.status,
        ((await stale.json()) as { message: string }).message.includes('recurring-professional.md'),
        await f.read('professional'),
      ],
      expected: [409, true, edited],
    })
    const current = await f.store.report()
    const request = { revisions: revisions(current), draft: { ...draft, text: 'One new routine' } }
    const responses = await Promise.all([post(request), post(request)])
    assert({
      given: 'two adds based on the same reviewed file',
      should: 'save only once rather than duplicate or lose content',
      actual: [
        responses.map((response) => response.status).sort(),
        (await f.store.report()).items.map((item) => item.text),
      ],
      expected: [
        [200, 409],
        ['Review Atlas', 'One new routine'],
      ],
    })
  })
})

test('recurring routes validate schedules and commitments before writing and reject foreign writes', async () => {
  await fixture(async (f) => {
    const app = createRecurringRoutes(f.store)
    const before = await f.store.report()
    const statuses: number[] = []
    for (const invalid of [
      { ...draft, pattern: 'MONTHLY-32' },
      { ...draft, pattern: 'constructor' },
      { ...draft, text: 'A title\n## Injected' },
      { ...draft, kind: 'commitment', time: '9:99' },
    ]) {
      const response = await app.request('http://localhost/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft: invalid, revisions: revisions(before) }),
      })
      statuses.push(response.status)
    }
    const foreign = await app.request('http://localhost/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ draft, revisions: revisions(before) }),
    })
    const missingType = await app.request('http://localhost/save', { method: 'POST', body: '{}' })
    assert({
      given: 'invalid schedules, heading injection, an invalid time and foreign requests',
      should: 'reject every request without creating notebook files',
      actual: [statuses, foreign.status, missingType.status, await readdir(f.root)],
      expected: [[400, 400, 400, 400], 403, 415, []],
    })
    const saved = await f.store.save({
      draft: { ...draft, kind: 'commitment', time: '9:30' },
      revisions: revisions(before),
    })
    assert({
      given: 'a valid short clock time',
      should: 'normalize it into the existing commitment spelling',
      actual: [saved.items[0].time, extractDayItems(ListDocument.fromMarkdown(await f.read('professional')), TODAY)],
      expected: ['09:30', ['09:30 > Review Atlas']],
    })
  })
})

test('next dates use the real matcher across short months and rare quarter days', () => {
  assert({
    given: 'monthly dates and the 92nd day of a quarter',
    should: 'skip impossible dates and find three occurrences even beyond a year',
    actual: [
      recurringDates('MONTHLY-31', new PlainDate('2031-02-01')),
      recurringDates('QUARTERLY-92', new PlainDate('2031-01-01')),
    ],
    expected: [
      ['2031-03-31', '2031-05-31', '2031-07-31'],
      ['2031-09-30', '2031-12-31', '2032-09-30'],
    ],
  })
})
