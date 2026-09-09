export interface StreakView {
  name: string
  title: string
  schedule: 'daily' | 'weekdays'
  start: string | null
  end: string | null
  status: 'active' | 'archived'
  relativePath: string
  revision: string
  why: string
  rule: string
  whyHtml?: string
  ruleHtml?: string
  bodyHtml: string
  done: string[]
  current: number
  best: number
}

export interface StreakDayView {
  date: string
  relativePath: string
  ended: boolean
}

export interface StreakReport {
  today: string
  streaks: StreakView[]
  days: StreakDayView[]
  warnings: string[]
}

export interface StreakMutation {
  name?: string
  undoId?: string
  message: string
}
