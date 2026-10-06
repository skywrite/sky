/** A chat's checklist is recovery state, not a separate project or workstream. */
export interface ChatPlanItem {
  id: string
  title: string
  status: 'pending' | 'working' | 'blocked' | 'done' | 'skipped'
  kind: 'action' | 'reasoning'
  detail: string
  evidence: string[]
}

export interface ChatPlanStep extends ChatPlanItem {
  items: ChatPlanItem[]
}

export interface ChatPlanArtifact {
  label: string
  /** An exact path or HTTPS URL returned by the cited tool. */
  location: string
  evidence: string
}

export interface ChatPlan {
  version: 1
  revision: number
  title: string
  outcome: string
  status: 'draft' | 'working' | 'needs-you' | 'paused' | 'complete'
  note: string
  steps: ChatPlanStep[]
  artifacts: ChatPlanArtifact[]
  finalCheck: string
  /** Conversation position, so deleting later turns cannot preserve their claims. */
  at: number
  attention: { id: string; kind: 'browser' | 'question'; message: string; native?: boolean } | null
}

export interface QueuedChatInstruction {
  /** Transport idempotency key, not a user-content filename. */
  id: string
  message: string
  /** Stop or recovery holds delivery independently of the live plan. */
  held?: boolean
}

export function planProgress(plan: ChatPlan): { done: number; total: number } {
  const items = plan.steps.flatMap((step) => (step.items.length ? step.items : [step]))
  return {
    done: items.filter((item) => item.status === 'done' || item.status === 'skipped').length,
    total: items.length,
  }
}

export function planLabel(plan: ChatPlan, busy: boolean, needsApproval = false): string {
  if (needsApproval || plan.attention) return 'Needs you'
  if (plan.status === 'complete') return 'Complete'
  if (plan.status === 'draft') return 'Plan ready'
  if (plan.status === 'paused' || !busy) return 'Paused'
  return 'Working'
}
