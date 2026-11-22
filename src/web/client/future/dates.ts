const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Dec 31', with the year when it is not this year's: 'Dec 31, 2027'. */
export function niceDate(ymd: string, today: string): string {
  const [year, month, day] = ymd.split('-')
  const sameYear = year === today.slice(0, 4)
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day) || day}${sameYear ? '' : `, ${year}`}`
}

/** How long a goal has until its date, as it is said. */
export function timeLeft(days: number): string {
  if (days > 1) return `${days} days left`
  if (days === 1) return '1 day left'
  if (days === 0) return 'Due today'
  return days === -1 ? '1 day past its date' : `${-days} days past its date`
}
