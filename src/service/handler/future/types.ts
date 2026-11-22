/** What the Future screen reads: each active goal, where it stands, and what is tied to it. */

/** A goal named from another goal */
export interface FutureGoalTie {
  name: string
  title: string
}

/** A decision tied to a goal by its `rel:` */
export interface FutureDecisionTie {
  name: string
  title: string
  /** Notebook-relative path of the decision's file */
  file: string
  /** The day it was made, or the day it came up while it is still open */
  since: string | null
}

export interface FutureIdeaTie {
  name: string
  title: string
  file: string
  status: 'draft' | 'exploring' | 'actioned'
}

export interface FutureHabitTie {
  name: string
  title: string
}

/** One recorded day of a goal's number; `day` counts days from the first day drawn */
export interface FuturePoint {
  date: string
  day: number
  value: number
  text: string
}

export interface FutureCheckpoint {
  value: number
  text: string
  date: string
  /** Its day on the chart, when the date falls inside what is drawn */
  day: number | null
  state: 'reached' | 'missed' | 'ahead'
}

/** A goal's number: the tracker it reads, where it started, where it is, and how far it has to go */
export interface FutureNumber {
  tracker: string
  trackerTitle: string
  unit: string
  /** The first day drawn: the goal's start, or the day it was written */
  from: string
  /** How many days the drawing spans, through the goal's date when that is still ahead */
  days: number
  /** Today's day on the chart */
  todayDay: number
  /** The goal date's day on the chart, when the goal has a date that is still ahead */
  dueDay: number | null
  points: FuturePoint[]
  first: FuturePoint | null
  latest: FuturePoint | null
  target: number | null
  targetText: string | null
  /** How far the number has moved since the first day, signed, as it is said: "+8 mi" */
  movedText: string | null
  toGoText: string | null
  /** 0 to 1 of the way from the first value to the target */
  progress: number | null
  reached: boolean
}

export interface FutureGoal {
  name: string
  title: string
  category: string
  /** Notebook-relative path of the goal's file */
  file: string
  /** The goal's own writing */
  bodyHtml: string
  due: string | null
  start: string | null
  daysLeft: number | null
  number: FutureNumber | null
  /** Why a connected number cannot be shown, in plain words */
  numberProblem: string | null
  checkpoints: FutureCheckpoint[]
  serves: FutureGoalTie | null
  smaller: FutureGoalTie[]
  inForce: FutureDecisionTie[]
  toDecide: FutureDecisionTie[]
  decided: FutureDecisionTie[]
  habits: FutureHabitTie[]
  ideas: FutureIdeaTie[]
}

export interface FutureReport {
  today: string
  goals: FutureGoal[]
  /** Decisions in force, each with the goals it serves */
  inForce: Array<FutureDecisionTie & { goals: FutureGoalTie[] }>
}

export interface FutureMutation {
  name: string
}

export class FutureError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message)
  }
}
