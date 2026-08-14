import { assert, test } from '#test'
import { typeMenuFrom } from './groupSections.ts'

test('typeMenuFrom derives the journal-type vocabulary from records', () => {
  const records = [
    { date: '2026-01-05', tags: ['Journal/Health', 'Health/Sleep'] },
    { date: '2026-01-06', tags: ['Journal/Health', 'Journal/Mood'] },
    { date: '2026-01-07', tags: ['Journal/Misc', 'Journal/Video', 'Journal/Markets/Bearish'] },
    { date: '2024-12-31', tags: ['Journal/Dreams'] },
  ]

  assert({
    given: 'records with type tags',
    should: 'count Journal/<Type> names, most-used first',
    actual: typeMenuFrom(records),
    expected: [
      { name: 'Health', count: 2 },
      { name: 'Mood', count: 1 },
    ],
  })
})

test('typeMenuFrom withholds Misc, Video, deeper paths, and the pre-2025 era', () => {
  const menu = typeMenuFrom([
    { date: '2026-01-07', tags: ['Journal/Misc', 'Journal/Video', 'Journal/Markets/Bearish', 'Health/Sleep'] },
    { date: '2024-06-01', tags: ['Journal/Dreams'] },
  ])
  assert({ given: 'only withheld or non-type tags', should: 'yield an empty menu', actual: menu, expected: [] })
})
