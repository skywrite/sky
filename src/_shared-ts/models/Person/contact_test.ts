import { assert, test } from '#test'
import { contactLine, contactRank } from './contact.ts'

test('contactLine - places read as people say them, and read back exactly', () => {
  const ranks = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 123]
  assert({
    given: 'places from first through one hundred twenty-third, and a person with no contact logged',
    should: 'use st, nd, rd and th as English does, teens included, and give each place back unchanged',
    actual: {
      words: ranks.map((rank) => contactLine({ rank, lastContact: null }).split(' ')[3]),
      back: ranks.map((rank) => contactRank(contactLine({ rank, lastContact: '2026-10-28' }))),
      none: [contactLine(null), contactRank(contactLine(null))],
      dated: contactLine({ rank: 7, lastContact: '2026-10-28T14:00:00Z' }),
    },
    expected: {
      words: ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '123rd'],
      back: ranks,
      none: ['> Contact: no contact logged', undefined],
      dated: '> Contact: your 7th most active contact · last in touch 2026-10-28',
    },
  })
})
