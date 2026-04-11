import colors from 'picocolors'
import { isWeekend } from '#universal/dates/dateFns/mod.ts'
import { isReleaseDay } from '#universal/dates/delivery/mod.ts'
import { BOLD_RELEASE_DAYS, DIM_WEEKENDS, PAD_LEN } from './_releases-config.ts'

export default function formatDay(date: Date): string {
  const dayOfTheMonth = String(date.getDate()).padEnd(PAD_LEN, ' ')
  if (isWeekend(date) && DIM_WEEKENDS) return colors.dim(dayOfTheMonth)
  if (isReleaseDay(date) && BOLD_RELEASE_DAYS) return colors.bold(colors.redBright(dayOfTheMonth))
  return dayOfTheMonth
}
