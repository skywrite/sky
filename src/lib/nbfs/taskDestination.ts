import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate, Week, type ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export type TaskFiling = 'day' | 'schedule'
export interface TaskPaths {
  DIR_TIME: string
  FILE_SCHEDULE_PERSONAL?: string
  FILE_SCHEDULE_PROFESSIONAL?: string
}

/** Use the full Monday–Sunday range, including a week split across two year directories. */
export function taskFiling(day: PlainDate, today: PlainDate): TaskFiling {
  return day.ymd > Week.of(today).end.ymd ? 'schedule' : 'day'
}

/** Calendar date in the notebook's zone, including an open day running past 24:00. */
export function planningDate(now: ZonedDateTime): PlainDate {
  return now.plainDateTime.plainDate.addDays(Math.floor(Number(now.time.split(':')[0]) / 24))
}

export function commandPlanningDate(context: { notebookNow: ZonedDateTime; systemNow: ZonedDateTime }): PlainDate {
  try {
    return planningDate(context.notebookNow)
  } catch {
    return planningDate(context.systemNow)
  }
}

export function scheduleFile(paths: TaskPaths, list: string): string {
  const personal = list === 'Reminders' || list.startsWith('Personal ')
  return (
    (personal ? paths.FILE_SCHEDULE_PERSONAL : paths.FILE_SCHEDULE_PROFESSIONAL) ??
    path.join(paths.DIR_TIME, personal ? 'schedule-personal.md' : 'schedule-professional.md')
  )
}

export function taskDestination(paths: TaskPaths, day: PlainDate, today: PlainDate, list: string) {
  const filed = taskFiling(day, today)
  return {
    filed,
    file: filed === 'day' ? path.join(paths.DIR_TIME, dayFile(day)) : scheduleFile(paths, list),
    list: filed === 'day' ? list : day.ymd,
  }
}
