const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parts(date: string): [year: number, month: number, day: number] {
  const [year, month, day] = date.split('-').map(Number)
  return [year, month, day]
}

/** `2026-11-24` as `Nov 24`. */
export function shortDay(date: string): string {
  const [, month, day] = parts(date)
  return `${MONTHS[month - 1]} ${day}`
}

/** `2026-11-24` as `Tue`, from the calendar alone (Sakamoto's method), with no clock involved. */
export function weekdayOf(date: string): string {
  const [year, month, day] = parts(date)
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const y = month < 3 ? year - 1 : year
  const index = (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7
  return WEEKDAYS[index]
}
