import { describe, expect, test } from 'bun:test'
import { meetingHref, meetingRouteOf, shortDate, trimMeetingHtml, weekdayOf, whenLine } from './meetingPage.tsx'

describe('trimMeetingHtml', () => {
  const html =
    '<h1 id="t">Atlas launch check-in</h1>\n<h2 id="timedate">Time/Date</h2>\n<ul><li>Friday</li></ul>\n<h2 id="attendees">Attendees</h2>\n<ul><li>Jane</li></ul>\n<h2 id="summary">Meeting Summary</h2>\n<p>Went well.</p>\n<h2 id="decisions">Decisions</h2>\n<ul><li>Ship it</li></ul>'
  test('drops the title line and the two sections the header carries, keeps the rest in order', () => {
    const out = trimMeetingHtml(html)
    expect(out.startsWith('<h2 id="summary">Meeting Summary</h2>')).toBe(true)
    expect(out).not.toContain('Time/Date')
    expect(out).not.toContain('Attendees')
    expect(out).not.toContain('Friday')
    expect(out).toContain('<h2 id="decisions">Decisions</h2>\n<ul><li>Ship it</li></ul>')
  })
  test('a body without those sections is untouched', () => {
    expect(trimMeetingHtml('<p>Just a note.</p>')).toBe('<p>Just a note.</p>')
  })
  test('a trailing section the header carries goes too', () => {
    expect(trimMeetingHtml('<h2>Summary</h2><p>x</p><h2>Attendees</h2><ul><li>Jane</li></ul>')).toBe(
      '<h2>Summary</h2><p>x</p>',
    )
  })
})

describe('dates', () => {
  test('short date and weekday from the calendar alone', () => {
    expect(shortDate('2026-08-18')).toBe('Aug 18')
    expect(weekdayOf('2026-08-18')).toBe('Tuesday')
    expect(weekdayOf('2026-01-01')).toBe('Thursday')
  })
  test('the line under the title', () => {
    expect(whenLine({ day: '2026-08-18', time: '14:00', minutes: 30, medium: 'Zoom' })).toBe(
      'Tuesday Aug 18 at 14:00, 30 minutes on Zoom',
    )
    expect(whenLine({ day: '2026-08-18', time: null, minutes: null, medium: 'Zoom' })).toBe('Tuesday Aug 18, on Zoom')
    expect(whenLine({ day: null, time: null, minutes: null, medium: '' })).toBe('')
  })
})

describe('the page address', () => {
  test('a meeting under a day has a page; other files open in the explorer', () => {
    expect(meetingHref('time/2026/W34/08-18/actions/meetings/14-00_Zoom_Jane_X.md')).toBe(
      '/2026-08-18/meetings/14-00_Zoom_Jane_X',
    )
    expect(meetingHref('time/2026/08/17-23/08-18/actions/meetings/A B.md')).toBe('/2026-08-18/meetings/A%20B')
    expect(meetingHref('time/2026/W34/08-18/actions/messages/x.md')).toBeNull()
    expect(meetingHref('people/Jane.md')).toBeNull()
  })
  test('the route names the day and the slug', () => {
    expect(meetingRouteOf('/2026-08-18/meetings/A%20B')).toEqual({ ymd: '2026-08-18', slug: 'A B' })
    expect(meetingRouteOf('/2026-08-18/meetings/')).toBeNull()
    expect(meetingRouteOf('/2026-08-18/files')).toBeNull()
    expect(meetingRouteOf('/explorer/time/x.md')).toBeNull()
  })
})
