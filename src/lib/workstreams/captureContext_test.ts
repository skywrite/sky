import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { loadCaptureContext } from './captureContext.ts'

const TODAY = new PlainDate('2025-03-12')
const layout = ALL_LAYOUTS[0]!

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-capture-context-'))
  const write = async (relative: string, content: string) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), content)
    return relative
  }
  return {
    root,
    write,
    day: (date: PlainDate) => path.join('time', layout.dayFile(date)),
    week: (date: PlainDate, name = 'week.md') => path.join('time', layout.weekDir(Week.of(date).startInYear), name),
    options: { notebookDir: root, timeDir: path.join(root, 'time'), today: TODAY, intent: 'Launch Atlas' },
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('capture context works for an empty or not-yet-created notebook', async () => {
  const f = await fixture()
  try {
    assert({
      given: 'a notebook without any day, week, or relationship files',
      should: 'return an empty evidence set without claiming retrieval failed',
      actual: await loadCaptureContext(f.options),
      expected: { sources: [], limited: false },
    })
    assert({
      given: 'a notebook directory that does not exist yet',
      should: 'allow the capture conversation to start without history',
      actual: await loadCaptureContext({ ...f.options, notebookDir: path.join(f.root, 'missing') }),
      expected: { sources: [], limited: false },
    })
  } finally {
    await f.clean()
  }
})

test('capture finds recent day records and weekly plans, summaries, and check-ins with stable provenance', async () => {
  const f = await fixture()
  try {
    const contents = new Map<string, string>([
      [
        await f.write(f.day(TODAY), 'Atlas is waiting for the pilot agreement.'),
        'Atlas is waiting for the pilot agreement.',
      ],
      [
        await f.write(f.week(TODAY), 'Plan: launch Atlas after customer approval.'),
        'Plan: launch Atlas after customer approval.',
      ],
      [
        await f.write(f.week(TODAY, 'summary.md'), 'Atlas: approval is still outstanding.'),
        'Atlas: approval is still outstanding.',
      ],
      [
        await f.write(f.week(TODAY, 'checkins.md'), 'Atlas: the customer meeting moved to Friday.'),
        'Atlas: the customer meeting moved to Friday.',
      ],
    ])
    const summary = path.join('time', layout.dayDir(TODAY.addDays(-1)), 'summary.md')
    contents.set(await f.write(summary, 'The Atlas demo went well.'), 'The Atlas demo went well.')
    await f.write(f.day(TODAY.addDays(-2)), 'Water the garden and buy groceries.')
    const result = await loadCaptureContext(f.options)
    const again = await loadCaptureContext(f.options)
    assert({
      given: 'relevant plans and lived records mixed with unrelated day files',
      should: 'return actual text and dated source labels, excluding the unrelated historical record',
      actual: {
        contents: result.sources.map((source) => [source.path, source.content]).sort(),
        relative: result.sources.every((source) => !path.isAbsolute(source.path)),
        dated: result.sources.every((source) => source.label.startsWith('2025-03-')),
        stable: again.sources.map((source) => source.id),
        limited: result.limited,
      },
      expected: {
        contents: [...contents].sort(),
        relative: true,
        dated: true,
        stable: result.sources.map((source) => source.id),
        limited: false,
      },
    })
  } finally {
    await f.clean()
  }
})

test('capture favors fresh evidence and excludes records outside the initial lookback', async () => {
  const f = await fixture()
  try {
    const fresh = await f.write(f.day(TODAY), 'Atlas: the committee approved the agreement.')
    const old = await f.write(f.day(TODAY.addDays(-20)), 'Atlas: the committee has not approved the agreement.')
    await f.write(f.day(TODAY.addDays(-35)), 'Atlas: obsolete launch plans.')
    const result = await loadCaptureContext(f.options)
    assert({
      given: 'two contradictory dated updates and one record beyond the day lookback',
      should: 'provide both recent versions with fresh evidence first, without calling a plan completed',
      actual: result.sources.map((source) => source.path),
      expected: [fresh, old],
    })
  } finally {
    await f.clean()
  }
})

test('capture uses a small current planning baseline when the intention has no lexical matches', async () => {
  const f = await fixture()
  try {
    const plan = await f.write(f.week(TODAY), 'Focus: customer onboarding and retention.')
    const checkin = await f.write(f.week(TODAY, 'checkins.md'), 'Customer onboarding is waiting for support input.')
    await f.write(f.week(TODAY, 'summary.md'), 'Customer feedback was discussed.')
    await f.write(f.day(TODAY.addDays(-1)), 'A grocery shopping list.')
    const result = await loadCaptureContext(f.options)
    assert({
      given: 'a new intention with different wording from the existing notebook',
      should: 'carry the current plan and check-in as orientation without filling the context with unrelated days',
      actual: result.sources.map((source) => source.path),
      expected: [plan, checkin],
    })
  } finally {
    await f.clean()
  }
})

test('capture resolves named and explicitly linked relationship profiles without loading unrelated people', async () => {
  const f = await fixture()
  try {
    const day = await f.write(
      f.day(TODAY),
      'Atlas launch: Jane Doe owns the pilot. [Partner contact](/rel/partners/contact.md) has the agreement.',
    )
    const jane = await f.write(
      'people/2025/ja/Jane-Doe.md',
      '---\nname: Jane Doe\n---\nJane coordinates pilot approvals.',
    )
    const atlas = await f.write('orgs/Atlas.md', '# Atlas\nSoftware company preparing its first enterprise pilot.')
    const contact = await f.write('rel/partners/contact.md', '# Taylor Quinn\nPilot procurement contact.')
    await f.write('people/2025/sa/Sam-Rivera.md', '# Sam Rivera\nUnrelated relationship.')
    const result = await loadCaptureContext(f.options)
    assert({
      given: 'an organization in the intention, a person in the day record, and a relative relationship link',
      should: 'include their profiles as context without making them stakeholders or reading every person',
      actual: result.sources.map((source) => source.path).sort(),
      expected: [day, jane, atlas, contact].sort(),
    })
  } finally {
    await f.clean()
  }
})

test('capture reads registered legacy layouts and clipped week buckets', async () => {
  const f = await fixture()
  try {
    const date = new PlainDate('2027-01-02')
    const oldLayout = ALL_LAYOUTS.at(-1)!
    const day = await f.write(path.join('time', oldLayout.dayFile(date)), 'Atlas: launch is ready.')
    const current = await f.write(f.week(date), 'Atlas: finish the pilot this week.')
    const previous = await f.write(f.week(new PlainDate('2026-12-31')), 'Atlas: approval was received last year.')
    const result = await loadCaptureContext({ ...f.options, today: date })
    assert({
      given: 'a legacy day layout and weekly files on both sides of a year boundary',
      should: 'use nbfs layout and Week semantics without assuming an ISO year or current config',
      actual: result.sources.map((source) => source.path).sort(),
      expected: [day, current, previous].sort(),
    })
  } finally {
    await f.clean()
  }
})

test('capture bounds source count and text while retaining the latest part of a large append-only file', async () => {
  const f = await fixture()
  try {
    for (let age = 0; age < 12; age++) await f.write(f.day(TODAY.addDays(-age)), 'Atlas: the pilot is underway.')
    const large = await f.write(
      f.week(TODAY, 'checkins.md'),
      `Atlas: launch plan.\n${'Historical unrelated note.\n'.repeat(6000)}\nAtlas launch: approval received; proceed with the pilot.`,
    )
    const result = await loadCaptureContext(f.options)
    assert({
      given: 'many matching records and a large check-in file with a recent update at its end',
      should: 'report incomplete coverage, bound context size, and retain the latest matching update',
      actual: {
        limited: result.limited,
        countBounded: result.sources.length <= 12,
        sizeBounded: result.sources.reduce((sum, source) => sum + source.content.length, 0) <= 24_000,
        perSourceBounded: result.sources.every((source) => source.content.length <= 4000),
        latest: result.sources.find((source) => source.path === large)?.content.includes('approval received'),
      },
      expected: { limited: true, countBounded: true, sizeBounded: true, perSourceBounded: true, latest: true },
    })
  } finally {
    await f.clean()
  }
})

test('capture rejects symlink files, symlink directories, and configured roots outside the notebook', async () => {
  const f = await fixture()
  const outside = await fixture()
  try {
    const outsideDay = await outside.write(outside.day(TODAY), 'Atlas: this must not escape into context.')
    await mkdir(path.dirname(path.join(f.root, f.day(TODAY))), { recursive: true })
    await symlink(path.join(outside.root, outsideDay), path.join(f.root, f.day(TODAY)))
    await outside.write('people/Atlas.md', 'External relationship content.')
    await symlink(path.join(outside.root, 'people'), path.join(f.root, 'people'))
    await f.write(f.week(TODAY), 'Atlas: [source](/rel/../../outside.md).')
    const result = await loadCaptureContext(f.options)
    const external = await loadCaptureContext({
      ...f.options,
      timeDir: path.join(outside.root, 'time'),
      relDir: path.join(outside.root, 'people'),
    })
    assert({
      given: 'a symlinked day, a symlinked people directory, and outside-root directory options',
      should: 'exclude external contents and disclose incomplete coverage',
      actual: {
        local: result.sources.map((source) => source.path),
        limited: result.limited,
        external,
      },
      expected: { local: [f.week(TODAY)], limited: true, external: { sources: [], limited: true } },
    })
  } finally {
    await f.clean()
    await outside.clean()
  }
})

test('capture respects cancellation before reading the notebook', async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    controller.abort()
    const error = await loadCaptureContext(f.options, controller.signal).then(
      () => null,
      (failure: unknown) => failure,
    )
    assert({
      given: 'a capture dismissed before context retrieval starts',
      should: 'propagate cancellation so no stale interview result is produced',
      actual: error instanceof Error && error.name === 'AbortError',
      expected: true,
    })
  } finally {
    await f.clean()
  }
})
