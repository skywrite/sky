import type { DayView } from './mod.ts'

export type DayPlanKind = 'todos' | 'commitments' | 'reminders'
export type NextDestination = Exclude<DayPlanKind, 'commitments'>
export type NextFile = 'next-professional.md' | 'next-personal.md'

export interface DayPlanInput {
  kind: DayPlanKind
  text: string
  category: string
  time?: string
}

export interface NextDayItem {
  id: string
  file: NextFile
  path: string
  list: string
  category: 'Professional' | 'Personal'
  text: string
  already: boolean
  unavailable: string | null
}

export interface DayPlanResult {
  view: DayView
  undo: string
  message: string
  href?: string
}

/** Accept the notebook's extended hours as well as ordinary clock times. */
export function normalizeDayTime(value: string): string | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim())
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

export { comparePlanItems } from '#lib/nbfs/comparePlanItems.ts'
