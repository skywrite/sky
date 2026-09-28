import { describe, expect, test } from 'bun:test'
import { MeetingDocument } from '#shared/models/Meeting/mod.ts'
import { attendeeNames, isMeetingPath, meetingTime, meetingTitle, threadOf } from './meeting.ts'

const meeting = (yaml: string, body = '') => MeetingDocument.fromMarkdown(`---\n${yaml}\n---\n\n${body}`)

describe('isMeetingPath', () => {
  test('a write-up under a day', () => {
    expect(isMeetingPath('time/2026/W34/08-18/actions/meetings/14-00_Zoom_Jane-Doe_Renewal.md')).toBe(true)
    expect(isMeetingPath('time/2026/W34/08-18/actions/messages/14-00_x.md')).toBe(false)
    expect(isMeetingPath('people/Jane-Doe.md')).toBe(false)
  })
})

describe('attendeeNames', () => {
  test('a string, a list, wiki links', () => {
    expect(attendeeNames('Jane Doe, Sam Rivera and Kai Hansen')).toEqual(['Jane Doe', 'Sam Rivera', 'Kai Hansen'])
    expect(attendeeNames(['[[Jane Doe]]', 'Sam Rivera'])).toEqual(['Jane Doe', 'Sam Rivera'])
    expect(attendeeNames(undefined)).toEqual([])
  })
})

describe('meetingTitle', () => {
  test('summary first, then the heading, then the file name', () => {
    expect(meetingTitle(meeting('who: Jane\nsummary: Atlas renewal', '# Meeting'), 'x/14-00_Zoom_Jane_Y.md')).toBe(
      'Atlas renewal',
    )
    expect(meetingTitle(meeting('who: Jane', '# Atlas launch check-in\n\ntext'), 'x/14-00_Zoom_Jane_Y.md')).toBe(
      'Atlas launch check-in',
    )
    expect(
      meetingTitle(meeting('who: Jane', '# Meeting'), 'x/actions/meetings/14-00_Zoom_Jane-Doe_Atlas-Renewal.md'),
    ).toBe('Atlas Renewal')
  })
})

describe('meetingTime', () => {
  test('a range, a length, and a bare time', () => {
    expect(meetingTime('2026-08-18 14:00 45m')).toEqual({ time: '14:00', minutes: 45 })
    expect(meetingTime('2026-01-20 14:00 - 14:30')).toEqual({ time: '14:00', minutes: 30 })
    expect(meetingTime('14:00 - 14:30')).toEqual({ time: '14:00', minutes: 30 })
    expect(meetingTime(undefined)).toEqual({ time: null, minutes: null })
  })
})

describe('threadOf', () => {
  const link = (path: string, date: string, label: string) => ({ path, date, label, type: 'day' as const, via: 'who' })
  const self = 'time/2026/W37/09-11/actions/meetings/14-00_A.md'
  const sep2 = link('time/2026/W36/09-02/actions/meetings/a.md', '2026-09-02', 'Sep 2')
  const jul9 = link('time/2026/W28/07-09/actions/meetings/b.md', '2026-07-09', 'Jul 9')
  const attendee = [
    link(self, '2026-09-11', 'this one'),
    sep2,
    jul9,
    link('time/2026/W39/09-26/actions/meetings/g.md', '2026-09-26', 'Sep 26'),
    link('time/2026/W36/09-02/actions/messages/m.md', '2026-09-02', 'a message'),
  ]
  const colleague = [
    link('time/2026/W37/09-09/actions/meetings/r1.md', '2026-09-09', 'Pipeline with Sam'),
    link('time/2026/W37/09-10/actions/meetings/r2.md', '2026-09-10', 'Unrelated with Sam'),
    link('time/2026/W37/09-10/actions/meetings/r3.md', '2026-09-10', 'Also unrelated with Sam'),
    link('time/2026/W38/09-18/actions/meetings/r4.md', '2026-09-18', 'Sam later'),
  ]
  const org = [
    link('time/2026/W37/09-09/actions/meetings/r1.md', '2026-09-09', 'Pipeline with Sam'),
    link('time/2026/W22/05-27/actions/meetings/c.md', '2026-05-27', 'Org May 27'),
    link('time/2026/W38/09-18/actions/meetings/r4.md', '2026-09-18', 'Sam later'),
    link('time/2026/W38/09-16/actions/meetings/o2.md', '2026-09-16', 'Org Sep 16'),
  ]
  const sources = [
    { links: attendee, weight: 2 },
    { links: colleague, weight: 1 },
    { links: org, weight: 1 },
  ]
  test('the best four by what they share, shown newest first; itself and non-meetings left out', () => {
    const thread = threadOf(sources, self, '2026-09-11')
    // Scores: Sep 2 and Jul 9 = 2 (attendee); Pipeline = 2 (colleague + org); the unrelated Sam ones and May 27 = 1.
    // The fourth pick is the newer of the ones scoring 1, title breaking the tie; then everything reads newest first.
    expect(thread.previous.map((m) => m.title)).toEqual([
      'Also unrelated with Sam',
      'Pipeline with Sam',
      'Sep 2',
      'Jul 9',
    ])
    expect(thread.previous.find((m) => m.title === 'Sep 2')?.href).toBe('/2026-09-02/meetings/a')
  })
  test('next is the best-scoring later meeting, the earliest among equals', () => {
    // Sep 26 with the attendee scores 2; Sam later scores 2 (colleague + org) and is earlier.
    expect(threadOf(sources, self, '2026-09-11').next?.title).toBe('Sam later')
  })
  test('without a day, the newest four and no next', () => {
    const thread = threadOf([{ links: [sep2], weight: 2 }], self, null)
    expect(thread.previous).toHaveLength(1)
    expect(thread.next).toBeNull()
  })
})

describe('the page address', () => {
  test('a day and a slug name the file under that day', async () => {
    const { meetingHref, meetingPathOf, meetingSlug } = await import('./meeting.ts')
    expect(meetingSlug('time/2026/W34/08-18/actions/meetings/14-00_Zoom_Jane_X.md')).toBe('14-00_Zoom_Jane_X')
    expect(meetingHref('time/2026/W34/08-18/actions/meetings/14-00_Zoom_Jane_X.md')).toBe(
      '/2026-08-18/meetings/14-00_Zoom_Jane_X',
    )
    expect(meetingHref('time/2026/W34/08-18/actions/messages/x.md')).toBeNull()
    expect(meetingHref('people/Jane.md')).toBeNull()
    const rel = meetingPathOf('2026-08-18', '14-00_Zoom_Jane_X', '/nb/time', '/nb')
    expect(rel).toMatch(/^time\/2026\/.*08-18\/actions\/meetings\/14-00_Zoom_Jane_X\.md$/)
    expect(meetingPathOf('2026-9-1', 'x', '/nb/time', '/nb')).toBeNull()
    expect(meetingPathOf('2026-08-18', '../x', '/nb/time', '/nb')).toBeNull()
  })
})
