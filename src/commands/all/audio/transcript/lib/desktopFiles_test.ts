import { assert, test } from '#test'
import { sortNewestFirst } from './desktopFiles.ts'

test('sortNewestFirst()', () => {
  const files = [
    { path: '/desktop/2026-07-01_old.vtt', mtimeMs: 1000 },
    { path: '/desktop/2026-07-18_new.vtt', mtimeMs: 3000 },
    { path: '/desktop/2026-07-10_mid.vtt', mtimeMs: 2000 },
  ]

  assert({
    given: 'files with distinct mtimes',
    should: 'order them newest first',
    actual: sortNewestFirst(files).map((f) => f.path),
    expected: ['/desktop/2026-07-18_new.vtt', '/desktop/2026-07-10_mid.vtt', '/desktop/2026-07-01_old.vtt'],
  })

  assert({
    given: 'files with identical mtimes',
    should: 'break the tie by path for deterministic order',
    actual: sortNewestFirst([
      { path: '/desktop/b.vtt', mtimeMs: 1000 },
      { path: '/desktop/a.vtt', mtimeMs: 1000 },
    ]).map((f) => f.path),
    expected: ['/desktop/a.vtt', '/desktop/b.vtt'],
  })

  const input = [
    { path: '/desktop/b.vtt', mtimeMs: 1 },
    { path: '/desktop/a.vtt', mtimeMs: 2 },
  ]
  sortNewestFirst(input)
  assert({
    given: 'an input array',
    should: 'not mutate it',
    actual: input[0].path,
    expected: '/desktop/b.vtt',
  })

  assert({
    given: 'no candidates',
    should: 'return an empty array',
    actual: sortNewestFirst([]),
    expected: [],
  })
})
