import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { commonSuffixSegments, parseOldDayPath, resolveUniverse } from './resolveUniverse.ts'

// --- parseOldDayPath (pure) ---

test('parseOldDayPath - historical day-directory schemes', () => {
  assert({
    given: 'a week-range scheme with an MM-DD day segment',
    should: 'extract the date and sub-path',
    actual: parseOldDayPath('time/2026/03/02-08/03-04/journal/entry.md'),
    expected: { ymd: '2026-03-04', subpath: 'journal/entry.md' },
  })
  assert({
    given: 'a week-range scheme with a bare DD day segment',
    should: 'take the month from the month segment',
    actual: parseOldDayPath('time/2025/05/05-11/10/actions/notes/idea.md'),
    expected: { ymd: '2025-05-10', subpath: 'actions/notes/idea.md' },
  })
  assert({
    given: 'a v2 path with a bare week dir',
    should: 'extract the date and sub-path',
    actual: parseOldDayPath('time/2026/W31/07-27/day.md'),
    expected: { ymd: '2026-07-27', subpath: 'day.md' },
  })
  assert({
    given: 'a v2 path with a month-labeled week dir',
    should: 'extract the date and sub-path',
    actual: parseOldDayPath('time/2026/07-W31/07-27/day.md'),
    expected: { ymd: '2026-07-27', subpath: 'day.md' },
  })
  assert({
    given: 'a non-time path',
    should: 'return null',
    actual: parseOldDayPath('projects/Atlas/plan.md'),
    expected: null,
  })
  assert({
    given: 'a time path with no sub-path below the day',
    should: 'return null',
    actual: parseOldDayPath('time/2026/03/02-08/03-04'),
    expected: null,
  })
})

test('commonSuffixSegments - counts trailing shared segments', () => {
  assert({
    given: 'an archived project path',
    should: 'share the project-name run',
    actual: commonSuffixSegments(
      'projects/Atlas/_project/overview.md',
      'projects/completed/2022/Atlas/_project/overview.md',
    ),
    expected: 3,
  })
  assert({
    given: 'a different project with the same file shape',
    should: 'share only the generic tail',
    actual: commonSuffixSegments(
      'projects/Atlas/_project/overview.md',
      'projects/completed/2022/Nimbus/_project/overview.md',
    ),
    expected: 2,
  })
})

// --- resolveUniverse (temp-dir fixture; never touches the real notebook) ---

test('resolveUniverse - direct, remapped, suffix-matched, and unresolved paths', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-resolve-test-'))
  try {
    const write = async (rel: string) => {
      await mkdir(path.join(base, path.dirname(rel)), { recursive: true })
      await writeFile(path.join(base, rel), '# stub\n')
    }

    // 1. exists at the recorded path
    await write('goals/2026.md')
    // 2. day dir renamed: the recorded week segment is from a retired scheme
    // (one dayDir never emits), the current-scheme target exists
    const currentDay = path.join('time', dayDir(new PlainDate('2026-03-04')))
    await write(path.join(currentDay, 'journal/entry.md'))
    // 3. archived project: suffix match must pick Atlas over the Nimbus decoy
    await write('projects/completed/2022/Atlas/_project/overview.md')
    await write('projects/completed/2022/Nimbus/_project/overview.md')

    const result = await resolveUniverse(
      [
        'goals/2026.md',
        'time/2026/03/RETIRED-WEEK/03-04/journal/entry.md',
        'projects/Atlas/_project/overview.md',
        'people/never/Existed.md',
      ],
      base,
    )

    assert({
      given: 'four recorded paths in four states',
      should: 'resolve three and report one unresolved',
      actual: result,
      expected: {
        resolved: [
          'goals/2026.md',
          path.join(currentDay, 'journal/entry.md'),
          'projects/completed/2022/Atlas/_project/overview.md',
        ],
        remapped: 1,
        suffixMatched: 1,
        unresolved: ['people/never/Existed.md'],
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('resolveUniverse - ambiguous suffix ties stay unresolved', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'sky-resolve-test-'))
  try {
    for (const rel of ['a/x/_project/overview.md', 'b/x/_project/overview.md']) {
      await mkdir(path.join(base, path.dirname(rel)), { recursive: true })
      await writeFile(path.join(base, rel), '# stub\n')
    }
    const result = await resolveUniverse(['old/x/_project/overview.md'], base)
    assert({
      given: 'two candidates with identical suffix depth',
      should: 'refuse to guess',
      actual: result.unresolved,
      expected: ['old/x/_project/overview.md'],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
