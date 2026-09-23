import { GOOGLE_CLOUD_SETUP, type SetupStepKey } from '../setup.ts'

// What a run of the automated setup looks like from outside: the steps as a
// checklist, the moments it needs the person, and how it ended. The settings
// page polls it; the terminal prints it as it changes.

/** The console steps, the two the person is part of, and the tidy-up after. */
export type SetupPhaseKey = 'signin' | SetupStepKey | 'consent' | 'tidy'

export interface SetupPhaseView {
  key: SetupPhaseKey
  /** In plain words, the way the checklist reads */
  label: string
  state: 'todo' | 'doing' | 'done'
}

/** The run is waiting for the person. */
export interface NeedsYou {
  step: SetupPhaseKey
  /** What to do, in plain words */
  message: string
  /** Present when Sky could not do the step itself: how to do it by hand; Continue tells Sky to look again */
  instruction?: string
}

export interface CloudSetupState {
  status: 'running' | 'done' | 'failed'
  steps: SetupPhaseView[]
  needsYou?: NeedsYou
  /** Known once the project exists */
  projectId?: string
  /** The account being connected, once the console has shown it — before the grant names it for sure */
  account?: string
  /** Set when the run is done: the account that granted access */
  email?: string
  /** Set when the run failed: why, in plain words */
  message?: string
}

const PHASE_LABELS: Record<'signin' | 'consent' | 'tidy', string> = {
  signin: 'Signing you in',
  consent: 'Asking Google what Sky may see',
  tidy: 'Removing leftovers from earlier tries',
}

export const SETUP_PHASES: readonly SetupPhaseKey[] = [
  'signin',
  ...GOOGLE_CLOUD_SETUP.map((s) => s.key),
  'consent',
  'tidy',
]

export function phaseLabel(key: SetupPhaseKey): string {
  if (key === 'signin' || key === 'consent' || key === 'tidy') return PHASE_LABELS[key]
  return GOOGLE_CLOUD_SETUP.find((step) => step.key === key)?.label ?? key
}

export function initialState(phases: readonly SetupPhaseKey[] = SETUP_PHASES): CloudSetupState {
  return {
    status: 'running',
    steps: phases.map((key) => ({ key, label: phaseLabel(key), state: 'todo' })),
  }
}

/** The state with one phase's mark changed; a phase starting clears any wait. */
export function withPhase(state: CloudSetupState, key: SetupPhaseKey, mark: SetupPhaseView['state']): CloudSetupState {
  const { needsYou: _cleared, ...rest } = state
  return {
    ...rest,
    steps: state.steps.map((step) => (step.key === key ? { ...step, state: mark } : step)),
  }
}

export function withNeedsYou(state: CloudSetupState, needsYou: NeedsYou): CloudSetupState {
  return { ...state, needsYou }
}

export function withoutNeedsYou(state: CloudSetupState): CloudSetupState {
  const { needsYou: _cleared, ...rest } = state
  return rest
}

export function finished(state: CloudSetupState, email: string): CloudSetupState {
  const { needsYou: _cleared, ...rest } = state
  return { ...rest, status: 'done', email, steps: state.steps.map((step) => ({ ...step, state: 'done' })) }
}

export function failed(state: CloudSetupState, message: string): CloudSetupState {
  const { needsYou: _cleared, ...rest } = state
  return { ...rest, status: 'failed', message }
}
