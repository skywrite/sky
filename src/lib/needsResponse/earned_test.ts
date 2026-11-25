import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import {
  creditListed,
  creditQuickReply,
  type EarnedEntry,
  pruneEarned,
  recentPoints,
  recordExpired,
  removeChecked,
  summarizeEarned,
} from './earned.ts'
import { calendarDayOf } from './notebookDay.ts'

const TZ = 'UTC'
const dayOf = calendarDayOf(TZ)
const JANE = 'Slack:dm:https://example.slack.com:D1'
const ALEX = 'Beeper:imessage:!chat-1'

test('a listed message earns what it is worth when answered, once', () => {
  const ticked = creditListed([], {
    id: JANE,
    waitingSince: '2031-03-17T09:00:00Z',
    closedAt: '2031-03-17T15:00:00Z',
    how: 'checked',
    timezone: TZ,
    dayOf,
  })
  const tickedAgain = creditListed(ticked, {
    id: JANE,
    waitingSince: '2031-03-17T09:00:00Z',
    closedAt: '2031-03-17T16:00:00Z',
    how: 'checked',
    timezone: TZ,
    dayOf,
  })
  // The reply itself went out at 10:00; the tick came five hours later.
  const replySeen = creditListed(ticked, {
    id: JANE,
    waitingSince: '2031-03-17T09:00:00Z',
    closedAt: '2031-03-17T10:00:00Z',
    how: 'replied',
    timezone: TZ,
    dayOf,
  })

  assert({
    given: 'a tick six hours in, a second tick, then the reply Sky finds from one hour in',
    should: 'earn 60 for the tick, ignore the repeat, and move to 100 at the true reply time',
    actual: {
      ticked: ticked.map((entry) => [entry.how, entry.marks, entry.points, entry.listed]),
      tickedAgain: tickedAgain.length,
      replySeen: replySeen.map((entry) => [entry.how, entry.closedAt, entry.points]),
    },
    expected: {
      ticked: [['checked', 2, 60, true]],
      tickedAgain: 1,
      replySeen: [['replied', '2031-03-17T10:00:00Z', 100]],
    },
  })
})

test('a quick reply off the list counts once per conversation a day, and only inside 4 hours', () => {
  let entries: EarnedEntry[] = []
  const reply = (id: string, lastInboundAt: string, repliedAt: string) => {
    entries = creditQuickReply(entries, { id, lastInboundAt, repliedAt, timezone: TZ, dayOf })
  }
  reply(JANE, '2031-03-17T09:00:00Z', '2031-03-17T09:05:00Z')
  reply(JANE, '2031-03-17T09:06:00Z', '2031-03-17T09:07:00Z') // same chat, same day
  reply(ALEX, '2031-03-17T09:00:00Z', '2031-03-17T09:30:00Z') // another conversation
  reply(JANE, '2031-03-18T10:00:00Z', '2031-03-18T10:20:00Z') // the next day
  reply(ALEX, '2031-03-14T09:00:00Z', '2031-03-17T11:00:00Z') // three days after a trailing "thanks"
  reply('Slack:dm:two-hours', '2031-03-17T09:00:00Z', '2031-03-17T11:00:00Z') // past the first mark, inside 4 hours
  reply('Slack:dm:five-hours', '2031-03-17T09:00:00Z', '2031-03-17T14:00:00Z') // past 4 hours

  assert({
    given: 'two replies in one chat on one day, one in another chat, one the next day, and replies of growing delay',
    should: 'earn once per conversation per day by the marks, and nothing past 4 hours',
    actual: entries.map((entry) => [entry.id, entry.closedAt, entry.points, entry.listed]),
    expected: [
      [JANE, '2031-03-17T09:05:00Z', 100, false],
      [ALEX, '2031-03-17T09:30:00Z', 100, false],
      [JANE, '2031-03-18T10:20:00Z', 100, false],
      ['Slack:dm:two-hours', '2031-03-17T11:00:00Z', 80, false],
    ],
  })

  const withListed = creditListed(entries, {
    id: JANE,
    waitingSince: '2031-03-17T10:00:00Z',
    closedAt: '2031-03-17T21:00:00Z',
    how: 'replied',
    timezone: TZ,
    dayOf,
  })

  assert({
    given: 'a listed message answered the same day as a quick reply in that conversation',
    should: 'still earn its own points: the once-a-day limit is for quick replies only',
    actual: withListed.filter((entry) => entry.id === JANE && entry.closedAt.startsWith('2031-03-17')).length,
    expected: 2,
  })

  // Alex was ticked at 15:00 for a message from 14:00; the reply itself went out at 15:30.
  const ticked = creditListed([], {
    id: ALEX,
    waitingSince: '2031-03-19T14:00:00Z',
    closedAt: '2031-03-19T15:00:00Z',
    how: 'checked',
    timezone: TZ,
    dayOf,
  })
  const replyAfterTick = creditQuickReply(ticked, {
    id: ALEX,
    lastInboundAt: '2031-03-19T14:00:00Z',
    repliedAt: '2031-03-19T15:30:00Z',
    timezone: TZ,
    dayOf,
  })
  const newMessageLater = creditQuickReply(ticked, {
    id: ALEX,
    lastInboundAt: '2031-03-19T16:00:00Z',
    repliedAt: '2031-03-19T16:10:00Z',
    timezone: TZ,
    dayOf,
  })

  assert({
    given: 'the reply to a message the owner had already ticked, then a new message answered quickly',
    should: 'not earn the ticked message twice, and still count the new one',
    actual: [replyAfterTick.length, newMessageLater.map((entry) => [entry.points, entry.listed])],
    expected: [
      1,
      [
        [100, true],
        [100, false],
      ],
    ],
  })
})

test('undo takes a tick back, and a week with no reply is recorded as worth nothing', () => {
  const ticked = creditListed([], {
    id: JANE,
    waitingSince: '2031-03-17T09:00:00Z',
    closedAt: '2031-03-17T09:30:00Z',
    how: 'checked',
    timezone: TZ,
    dayOf,
  })
  const expired = recordExpired([], {
    id: ALEX,
    waitingSince: '2031-03-10T09:00:00Z',
    expiredAt: '2031-03-17T09:00:00Z',
    dayOf,
  })

  assert({
    given: 'an undone tick and an expired message',
    should: 'leave no points for either',
    actual: {
      afterUndo: removeChecked(ticked, JANE).length,
      undoOfNothing: removeChecked(expired, ALEX).length,
      expired: expired.map((entry) => [entry.how, entry.marks, entry.points]),
      expiredTwice: recordExpired(expired, {
        id: ALEX,
        waitingSince: '2031-03-10T09:00:00Z',
        expiredAt: '2031-03-17T10:00:00Z',
        dayOf,
      }).length,
    },
    expected: { afterUndo: 0, undoOfNothing: 1, expired: [['expired', 5, 0]], expiredTwice: 1 },
  })
})

test('the summary adds points up per day with no cap', () => {
  const now = Instant.from('2031-03-17T20:00:00Z').epochMilliseconds
  let entries: EarnedEntry[] = []
  // Today: three replies inside the hour and one after 9 hours.
  for (const chat of ['a', 'b', 'c']) {
    entries = creditQuickReply(entries, {
      id: `Slack:dm:${chat}`,
      lastInboundAt: '2031-03-17T09:00:00Z',
      repliedAt: '2031-03-17T09:10:00Z',
      timezone: TZ,
      dayOf,
    })
  }
  entries = creditListed(entries, {
    id: JANE,
    waitingSince: '2031-03-17T08:00:00Z',
    closedAt: '2031-03-17T17:00:00Z',
    how: 'replied',
    timezone: TZ,
    dayOf,
  })
  // Five days ago: one reply after two days, and one message that expired.
  entries = creditListed(entries, {
    id: ALEX,
    waitingSince: '2031-03-10T09:00:00Z',
    closedAt: '2031-03-12T10:00:00Z',
    how: 'checked',
    timezone: TZ,
    dayOf,
  })
  entries = recordExpired(entries, {
    id: 'Email:jane@example.com:t1',
    waitingSince: '2031-03-05T09:00:00Z',
    expiredAt: '2031-03-12T09:00:00Z',
    dayOf,
  })
  // Long ago: outside the 30 days shown, inside what is kept.
  entries = creditListed(entries, {
    id: ALEX,
    waitingSince: '2031-01-20T09:00:00Z',
    closedAt: '2031-01-20T10:00:00Z',
    how: 'replied',
    timezone: TZ,
    dayOf,
  })

  const score = summarizeEarned(entries, { today: '2031-03-17' })

  assert({
    given: 'four replies today, one five days ago, an expiry, and one from two months back',
    should: 'total each day, the week and the waits, leaving the old reply out of the 30 days',
    actual: {
      today: score.today,
      week: score.week,
      days: score.days.length,
      first: score.days[0].date,
      last: score.days.at(-1),
      fiveDaysAgo: score.days.find((day) => day.date === '2031-03-12'),
      waits: score.waits,
      recent: recentPoints(entries, '2031-03-17'),
      kept: pruneEarned(entries, now).length,
      keptLater: pruneEarned(entries, now + 10 * 24 * 3_600_000).length,
    },
    expected: {
      today: { points: 360, replies: 4, quick: 3 },
      week: { points: 380, replies: 5 },
      days: 30,
      first: '2031-02-16',
      last: { date: '2031-03-17', points: 360, replies: 4 },
      fiveDaysAgo: { date: '2031-03-12', points: 20, replies: 1 },
      waits: [3, 0, 1, 0, 1, 1],
      recent: { today: 360, week: 380 },
      kept: 7,
      keptLater: 6,
    },
  })
})
