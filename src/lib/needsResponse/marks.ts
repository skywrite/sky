/** Hours a message may wait before each drop in what a reply to it earns. */
export const RESPONSE_MARK_HOURS = [1, 4, 12, 24, 72] as const

/** Points a reply earns, by how many marks the message has passed. Past the last mark it earns nothing. */
export const RESPONSE_POINTS = [100, 80, 60, 40, 20, 0] as const

/**
 * The clock stops overnight between these local times.
 * Only the marks shorter than a day leave the night out; the day marks follow the calendar,
 * so "1 day" stays one day on the wall.
 */
export const QUIET_HOURS = { from: '22:00', until: '07:00' } as const

/**
 * A reply to a message that never reached the list counts when the message had passed at most this many marks,
 * which is a reply inside 4 hours.
 */
export const QUICK_REPLY_MAX_MARKS = 1
