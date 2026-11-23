export { default, default as GoalDocument } from './document/mod.ts'
export type { Goal, GoalCategory, GoalCheckpoint } from './document/mod.ts'
export {
  activeGoalsDir,
  endedGoalsDir,
  GOAL_ENDINGS,
  goalNameFromPath,
  goalStatusFromPath,
  isOneGoalFile,
} from './paths.ts'
export type { GoalEnding, GoalStatus } from './paths.ts'
