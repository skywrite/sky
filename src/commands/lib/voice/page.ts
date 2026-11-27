/**
 * The speaking model's short page: what Sky knows right now, in plain lines it can answer from
 * without handing the question to the backend. Built from what the call already loaded: no model
 * call and no new reads, so the call starts as fast as before. OpenAI's Live prompting guide warns
 * that large context makes the speaking model invent, so every part has a byte cap and the whole
 * page stays under PAGE_MAX_BYTES.
 */
import type { DayItemList } from '#commands/all/day/items/lib/items.ts'
import type { CheckedMeeting, MeetingCheck } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { DECISIONS_LIMIT } from '#commands/lib/voice/contextEntities.ts'
import AboutMe from '#shared/models/AboutMe/mod.ts'
import { GoalDocument, goalNameFromPath, isOneGoalFile } from '#shared/models/Goal/mod.ts'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/** The whole page, in UTF-8 bytes: about 1,500 tokens, a small share of Live's 16,384-token instructions. */
export const PAGE_MAX_BYTES = 6000
/** One mid-call update; Live accepts at most 500 tokens per append. */
export const UPDATE_MAX_BYTES = 1200

const CAPS = {
  now: 240,
  profile: 600,
  goals: 500,
  decisions: 500,
  people: 600,
  calendar: 1100,
  lists: 1100,
  memory: 800,
} as const

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const encoder = new TextEncoder()

export function byteLength(text: string): number {
  return encoder.encode(text).length
}

/** Cut to a byte budget on a character boundary; a cut line ends in "...". */
export function clip(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const char of text) {
    const size = byteLength(char)
    if (used + size > maxBytes - 3) break
    out += char
    used += size
  }
  return `${out.trimEnd()}...`
}

/** Keep whole lines while they fit; a line that does not fit ends the block. */
function fitLines(lines: string[], maxBytes: number): string {
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const size = byteLength(line) + (kept.length ? 1 : 0)
    if (used + size > maxBytes) break
    kept.push(line)
    used += size
  }
  return kept.join('\n')
}

/** `HH:MM` (extended hours legal) as a spoken 12-hour time. */
export function spokenTime(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const hour = hours % 24
  const suffix = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`
}

function spokenDate(date: PlainDate): string {
  return `${date.dayLong}, ${MONTHS[date.month - 1]} ${date.day}, ${date.year}`
}

export interface PageClock {
  /** The notebook's day and time; past midnight the time runs on (25:30) until the next day starts */
  date: string
  time: string
  timezone: string
  /** The computer's own date, time and zone, for when the notebook's day is more than a night behind */
  systemDate?: string
  systemTime?: string
  systemTimezone?: string
}

/** The date is stated, never left to the model: it answered a date question wrong without it. */
export function renderNow(clock: PageClock): string {
  const date = PlainDate.from(clock.date)
  const hours = Number(clock.time.split(':')[0] ?? 0)
  const zone = clock.timezone ? ` (${clock.timezone})` : ''
  // More than a night behind, no day has been started for a while: the real date leads, and the
  // notebook's day is named for what it is, since today's calendar and lists below come from it.
  const real = clock.systemDate ? PlainDate.from(clock.systemDate) : date.addDays(Math.floor(hours / 24))
  const systemZone = clock.systemTime && clock.systemTimezone ? ` (${clock.systemTimezone})` : zone
  const line =
    hours >= 48
      ? `It is ${spokenDate(real)}, ${spokenTime(clock.systemTime ?? clock.time)}${systemZone}, when this call started. The notebook's last started day is ${spokenDate(date)}; the calendar and lists below are from that day.`
      : hours >= 24
        ? `It is ${spokenTime(clock.time)}, after midnight, but in the notebook it is still ${spokenDate(date)}: "today" means that day${zone}.`
        : `It is ${spokenDate(date)}, ${spokenTime(clock.time)}${zone}, when this call started.`
  return clip(line, CAPS.now)
}

function firstParagraph(text: string): string {
  const paragraph = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean)
  return (paragraph ?? '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Who the user is, from their about-me file. */
export function renderProfile(text: string | undefined): string {
  if (!text?.trim()) return ''
  const me = AboutMe.fromMarkdown(text)
  const facts = [
    me.fullName ? `Name: ${me.fullName}.` : '',
    me.title || me.company ? `Work: ${[me.title, me.company].filter(Boolean).join(', ')}.` : '',
    me.location ? `Lives in ${clip(me.location, 80)}.` : '',
    me.family ? `Family: ${clip(firstParagraph(me.family), 160)}.` : '',
    me.communicationStyle ? `Communication style: ${clip(firstParagraph(me.communicationStyle), 120)}.` : '',
  ].filter(Boolean)
  const head = clip(facts.join(' '), CAPS.profile)
  const bio = firstParagraph(me.bio)
  const room = CAPS.profile - byteLength(head) - 1
  return [head, bio && room > 60 ? clip(bio, room) : ''].filter(Boolean).join(' ')
}

export interface GoalRecord {
  source: string
  body: string
}

/**
 * The active goals. A one-goal file gives its title (the title field, else its first heading, else its
 * name); an older whole-category file gives the goals written inside it, area and outcome, and a file
 * with none, like the ones a new notebook starts with, gives nothing.
 */
export function renderGoals(goals: GoalRecord[]): string {
  const plain = (text: string) => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  const titles = goals.flatMap((goal) => {
    const doc = GoalDocument.fromMarkdown(goal.body) as GoalDocument
    if (isOneGoalFile(goal.source)) {
      const title = typeof doc.yaml['title'] === 'string' ? doc.yaml['title'].trim() : ''
      const heading = doc.markdown.match(/^#\s+(.+)$/m)?.[1]
      return [plain(title || heading || goalNameFromPath(goal.source).replace(/[-_]+/g, ' '))]
    }
    return doc.goals.map((written) =>
      clip(plain(written.outcome ? `${written.area}: ${written.outcome}` : written.area), 120),
    )
  })
  const kept = titles.filter(Boolean)
  return kept.length ? clip(kept.join('; '), CAPS.goals) : ''
}

/** A decision as the notebook index gives it: its name (a short file slug), then Summary:, Identified:, Target: lines. */
export interface DecisionRecord {
  body: string
}

/** "2026-11-30" as "November 30, 2026"; any other target text as written. */
function spokenTarget(text: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined
  return match && month ? `${month} ${Number(match[3])}, ${match[1]}` : text
}

/**
 * Pending decisions from the notebook index, the question each one asks and its target when it has one.
 * Undefined means the index could not be read, which is not the same as none pending.
 */
export function renderDecisions(decisions: DecisionRecord[] | undefined): string {
  if (decisions === undefined) return 'Pending decisions could not be read when this call started.'
  const entries = decisions
    .map((decision) => {
      const [name = '', ...rest] = decision.body.split('\n')
      const field = (label: string) =>
        rest
          .find((line) => line.startsWith(`${label}: `))
          ?.slice(label.length + 2)
          .trim()
      // The summary is the decision's question; the name is a slug cut short, kept only as a fallback.
      const question = clip(field('Summary') || name.replace(/[-_]+/g, ' ').trim(), 140)
      const target = field('Target')
      return target ? `${question} (target ${spokenTarget(target)})` : question
    })
    .filter(Boolean)
  if (!entries.length) return 'None pending.'
  // The index lists at most DECISIONS_LIMIT, so a full list may not be all of them.
  const count = entries.length >= DECISIONS_LIMIT ? `At least ${entries.length} pending` : `${entries.length} pending`
  const line = (kept: string[]) =>
    `${count}: ${kept.join('; ')}${kept.length < entries.length ? `; and ${entries.length - kept.length} more` : ''}.`
  const kept: string[] = []
  for (const entry of entries) {
    if (byteLength(line([...kept, entry])) > CAPS.decisions) break
    kept.push(entry)
  }
  return kept.length ? line(kept) : clip(line(entries.slice(0, 1)), CAPS.decisions)
}

export interface PersonRecord {
  body: string
}

/** The people the user deals with most, in interaction order: name, then title and organization when known. */
export function renderPeople(people: PersonRecord[]): string {
  const entries = people.slice(0, 15).map((person) => {
    const [name = '', ...rest] = person.body.split('\n')
    const title = rest.find((line) => line.startsWith('Title: '))?.slice(7)
    const org = rest.find((line) => line.startsWith('Organization: '))?.slice(14)
    const detail = [title, org].filter(Boolean).join(', ')
    return detail ? `${name.trim()} (${clip(detail, 60)})` : name.trim()
  })
  const names = entries.filter(Boolean)
  if (!names.length) return ''
  const kept: string[] = []
  for (const name of names) {
    if (byteLength([...kept, name].join('; ')) > CAPS.people) break
    kept.push(name)
  }
  return kept.join('; ')
}

type MeetingState = 'upcoming' | 'happening now' | 'over, notes logged' | 'over, no notes logged' | 'over'

function meetingState(meeting: CheckedMeeting, clock: PlainDateTime, notebookRead: boolean): MeetingState {
  const { event } = meeting
  if (!event.allDay) {
    const at = (rfc: string) =>
      clock.until(new PlainDateTime({ date: rfc.slice(0, 10), time: rfc.slice(11, 16) })).total('minutes')
    if (at(event.start) > 0) return 'upcoming'
    if (at(event.end) > 0) return 'happening now'
  }
  if (meeting.record) return 'over, notes logged'
  return notebookRead ? 'over, no notes logged' : 'over'
}

function meetingLine(meeting: CheckedMeeting, state: MeetingState): string {
  const { event } = meeting
  const when = event.allDay
    ? 'All day'
    : `${spokenTime(event.start.slice(11, 16))} to ${spokenTime(event.end.slice(11, 16))}`
  const others = event.attendees.filter((attendee) => !attendee.self).map((a) => a.name ?? a.email.split('@')[0])
  const shown = others.slice(0, 2)
  const who = shown.length
    ? ` with ${shown.join(' and ')}${others.length > shown.length ? ` and ${others.length - shown.length} others` : ''}`
    : ''
  return `- ${when}: ${clip(event.title || 'Untitled', 60)}${who}; ${state}.`
}

/** How complete a calendar check is: unread, read with an account failing, or read cleanly. */
function completeness(check: MeetingCheck): number {
  if (!check.calendarRead) return 0
  return check.errors.length ? 1 : 2
}

/**
 * The calendar check to keep when it is fetched again mid-call: the fresh one only when it is at least as
 * complete, so a failing account, or a notebook that did not answer, never replaces a fuller list.
 */
export function betterCheck(current: MeetingCheck, fresh: MeetingCheck): MeetingCheck {
  const [was, now] = [completeness(current), completeness(fresh)]
  if (now > was) return fresh
  return now === was && now > 0 && (fresh.notebookRead || !current.notebookRead) ? fresh : current
}

/** Today's meetings as the ear wants them: absolute times, a short title, two names, where it stands. */
export function renderCalendar(check: MeetingCheck | undefined, clock: PageClock): string {
  if (!check) return 'The calendar was not checked when this call started.'
  if (!check.calendarRead) {
    const reason = check.errors.find((error) => error.trim())
    return reason
      ? clip(`The calendar could not be read when this call started: ${reason.trim()}`, 300)
      : 'The calendar could not be read when this call started.'
  }
  const now = new PlainDateTime({ date: clock.date, time: clock.time })
  const notifications = check.notifications?.length
    ? clip(
        `Family notifications: ${check.notifications
          .map(
            (event) =>
              `${clip(event.title || 'Untitled', 50)}${event.allDay ? '' : ` at ${spokenTime(event.start.slice(11, 16))}`}`,
          )
          .join('; ')}.`,
        260,
      )
    : ''
  const partial = check.errors.length ? 'Some calendar accounts could not be read, so meetings may be missing.' : ''
  if (!check.meetings.length)
    return ['No meetings on the calendar today.', partial, notifications].filter(Boolean).join('\n')
  const states = check.meetings.map((meeting) => meetingState(meeting, now, check.notebookRead))
  const lines = check.meetings.map((meeting, i) => meetingLine(meeting, states[i]!))
  const budget =
    CAPS.calendar - (notifications ? byteLength(notifications) + 1 : 0) - (partial ? byteLength(partial) + 1 : 0)
  let body = lines.join('\n')
  if (byteLength(body) > budget) {
    // Past meetings collapse first: the current and next meetings are what a question asks about.
    const past = states.filter((state) => state.startsWith('over')).length
    const logged = states.filter((state) => state === 'over, notes logged').length
    const ahead = lines.filter((_, i) => !states[i]!.startsWith('over'))
    const head = past ? [`Earlier today: ${past} meetings, ${logged} with notes logged.`] : []
    const fitted = fitLines([...head, ...ahead], budget - 60)
    const dropped = head.length + ahead.length - fitted.split('\n').length
    body = dropped > 0 ? `${fitted}\nAnd ${dropped} more later today; delegate to hear them.` : fitted
  }
  return [body, partial, notifications].filter(Boolean).join('\n')
}

/** Shares of the lists' budget, in reading priority; what a group leaves unused carries to the next. */
const LIST_GROUPS = [
  { label: 'Most important', share: 280, matches: (title: string) => title.toLowerCase().includes('most important') },
  { label: 'Commitments', share: 300, matches: (title: string) => title.endsWith('Commitments') },
  { label: 'To-dos', share: 320, matches: (title: string) => title.endsWith('Todos') },
  { label: 'Reminders', share: 160, matches: (title: string) => title === 'Reminders' },
] as const

/**
 * `15:00 > Call Jane` reads as `3:00 PM, Call Jane`, without links, cut short: an item arrives with its
 * nested notes already folded into one line, and the item itself comes first.
 */
function itemText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const timed = line.match(/^(\d{1,2}:\d{2})\s*>\s*(.*)$/)
  const spoken = timed ? `${spokenTime(timed[1]!)}, ${timed[2]}` : line
  return clip(
    spoken
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    70,
  )
}

/**
 * Today's open items by list. Streaks are left out (they are checked off afterwards), and so is a count of
 * what is done: the Complete lists also log messages, notes and imports, so a count would mislead.
 */
export function renderLists(lists: DayItemList[] | undefined): string {
  if (!lists) return "Today's lists could not be read when this call started."
  const lines: string[] = []
  let carry = 0
  for (const group of LIST_GROUPS) {
    const open = lists
      .filter((list) => group.matches(list.title))
      .flatMap((list) => {
        const category = list.title.replace(/\s*(Commitments|Todos)$/, '').trim()
        const qualify = group.label !== 'Most important' && group.label !== 'Reminders' && category
        return list.items
          .filter((item) => !item.done)
          .map((item) => itemText(item.text))
          .filter(Boolean)
          .map((text) => (qualify ? `${text} (${category.toLowerCase()})` : text))
      })
    // Reminders come last and can run to dozens: they get only a little of what the lists before them left.
    const budget = group.share + (group.label === 'Reminders' ? Math.min(carry, 200) : carry)
    if (!open.length) {
      if (group.label !== 'Reminders') lines.push(`${group.label}: none open.`)
      carry = Math.max(0, budget - 30)
      continue
    }
    const prefix = `${group.label}: `
    const kept: string[] = []
    for (const [i, item] of open.entries()) {
      const rest = open.length - i - 1
      const tail = rest > 0 ? `; and ${rest} more` : ''
      const candidate = `${prefix}${[...kept, item].join('; ')}${tail}.`
      if (byteLength(candidate) > budget && kept.length) break
      kept.push(item)
    }
    const more = open.length - kept.length
    const line = clip(`${prefix}${kept.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`, budget)
    lines.push(line)
    carry = Math.max(0, budget - byteLength(line))
  }
  return fitLines(lines, CAPS.lists)
}

/** The one-line summaries of what Sky remembers: shorthand, how the user wants answers, open threads. */
export function renderMemory(memories: MemoryEntry[]): string {
  const summary = (memory: MemoryEntry) => clip(memory.summary.replace(/\s+/g, ' ').trim().replace(/\.$/, ''), 120)
  const byFreshness = (a: MemoryEntry, b: MemoryEntry) => (b.freshness ?? '').localeCompare(a.freshness ?? '')
  const glossary = memories
    .filter((m) => m.kind === 'glossary')
    .sort(byFreshness)
    .slice(0, 6)
  const preferences = memories
    .filter((m) => m.kind === 'preference')
    .sort((a, b) => b.uses - a.uses || byFreshness(a, b))
    .slice(0, 6)
  const threads = memories
    .filter((m) => m.kind === 'thread')
    .sort(byFreshness)
    .slice(0, 3)
  const lines = [
    glossary.length ? `Shorthand the user uses: ${glossary.map(summary).join('; ')}.` : '',
    preferences.length ? `How the user wants things done: ${preferences.map(summary).join('; ')}.` : '',
    threads.length ? `Open threads: ${threads.map(summary).join('; ')}.` : '',
  ].filter(Boolean)
  return fitLines(
    lines.map((line) => clip(line, 480)),
    CAPS.memory,
  )
}

export interface VoicePageInput {
  clock: PageClock
  profileText?: string
  goals: GoalRecord[]
  /** Undefined when the notebook index could not be read */
  decisions?: DecisionRecord[]
  people: PersonRecord[]
  check?: MeetingCheck
  lists?: DayItemList[]
  memories: MemoryEntry[]
}

/** The parts of the page an update can replace mid-call, rendered the same way the page renders them. */
export interface TodayParts {
  calendar: string
  lists: string
}

export function renderToday(input: Pick<VoicePageInput, 'check' | 'lists' | 'clock'>): TodayParts {
  return { calendar: renderCalendar(input.check, input.clock), lists: renderLists(input.lists) }
}

/** The page, in sections the prompt introduces as "What you know right now". */
export function renderVoicePage(input: VoicePageInput): string {
  const today = renderToday(input)
  const sections = [
    ['Now', renderNow(input.clock)],
    ['About the user', renderProfile(input.profileText)],
    ['Goals', renderGoals(input.goals)],
    ['Pending decisions', renderDecisions(input.decisions)],
    ['People the user deals with most', renderPeople(input.people)],
    ["Today's calendar", today.calendar],
    ["Today's lists", today.lists],
    ['What you remember about the user', renderMemory(input.memories)],
  ] as const
  const body = sections
    .filter(([, text]) => text)
    .map(([title, text]) => `${title}:\n${text}`)
    .join('\n\n')
  const footer =
    'This is a short summary from when the call started, not the whole notebook. A later note that starts with "Update at" replaces the matching part.'
  return clip(`${body}\n\n${footer}`, PAGE_MAX_BYTES)
}

/** Notes for the parts that changed since the last version the speaking model was told, each within one append. */
export function todayUpdates(previous: TodayParts, next: TodayParts, time: string): string[] {
  const notes: string[] = []
  const at = spokenTime(time)
  if (next.lists !== previous.lists)
    notes.push(
      clip(`Update at ${at}. This replaces "Today's lists"; no reply needed.\n${next.lists}`, UPDATE_MAX_BYTES),
    )
  if (next.calendar !== previous.calendar)
    notes.push(
      clip(`Update at ${at}. This replaces "Today's calendar"; no reply needed.\n${next.calendar}`, UPDATE_MAX_BYTES),
    )
  return notes
}
