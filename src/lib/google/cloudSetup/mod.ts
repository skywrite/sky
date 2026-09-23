// Sky sets up the Google Cloud side itself — project, APIs, app, client —
// in a browser window the person signs in to, then runs the grant. What
// used to be a ten-minute console walkthrough becomes: sign in, tick the
// boxes.

export { startCloudSetup, WINDOW_CLOSED_MESSAGE } from './run.ts'
export type { CloudSetupOptions, CloudSetupRun, SetupEngine, SetupWindow } from './run.ts'
export { SETUP_PHASES, initialState, phaseLabel } from './state.ts'
export type { CloudSetupState, NeedsYou, SetupPhaseKey, SetupPhaseView } from './state.ts'
export { SETUP_LEDGER_FILE, SETUP_PROFILE_DIR, SETUP_RESUME_FILE, readLedger, readResume } from './resume.ts'
export { leftoverProjects, tidyProjects } from './tidy.ts'
export { SETUP_DIAGNOSTICS_DIR } from './diagnostics.ts'
export { CONSOLE_STEPS } from './consoleSteps.ts'
export type { ConsoleStep, StepContext } from './consoleSteps.ts'
