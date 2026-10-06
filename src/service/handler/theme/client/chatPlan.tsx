import { ActionIcon, Button, Drawer } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useState, type ReactNode } from 'react'
import {
  planLabel,
  planProgress,
  type ChatPlan,
  type ChatPlanItem,
  type QueuedChatInstruction,
} from '#universal/ai/chatPlan.ts'

export function ChatPlanBar({
  plan,
  busy,
  needsApproval,
  opened,
  onOpen,
}: {
  plan: ChatPlan
  busy: boolean
  needsApproval: boolean
  opened: boolean
  onOpen: () => void
}) {
  const progress = planProgress(plan)
  const label = planLabel(plan, busy, needsApproval)
  const current = plan.steps.find((step) => step.status === 'working' || step.status === 'blocked')
  return (
    <div className="sky-plan-bar" data-attention={label === 'Needs you'}>
      <div className="sky-plan-bar-copy">
        <span className="sky-plan-status">
          <span className="sky-plan-dot" data-working={label === 'Working'} />
          {label}{' '}
          <span className="sky-plan-count">
            · {progress.done} of {progress.total}
          </span>
        </span>
        <span className="sky-plan-current">
          {plan.attention?.message ??
            (plan.status === 'paused' && plan.note
              ? plan.note
              : needsApproval
                ? 'Review the request to continue'
                : (current?.title ?? plan.title))}
        </span>
      </div>
      <Button size="sm" onClick={onOpen} aria-expanded={opened} aria-controls="sky-chat-plan">
        View plan <span aria-hidden="true">↗</span>
      </Button>
    </div>
  )
}

const statusText: Record<ChatPlanItem['status'], string> = {
  pending: 'Not started',
  working: 'In progress',
  blocked: 'Needs attention',
  done: 'Done',
  skipped: 'Skipped',
}

function ItemMark({ item }: { item: ChatPlanItem }) {
  return (
    <span className="sky-plan-mark" data-status={item.status} aria-label={statusText[item.status]}>
      {item.status === 'done'
        ? '✓'
        : item.status === 'skipped'
          ? '−'
          : item.status === 'blocked'
            ? '!'
            : item.status === 'working'
              ? '•'
              : ''}
    </span>
  )
}

export function ChatPlanPanel({
  id,
  plan,
  queued,
  busy,
  needsApproval,
  approvals,
  onAction,
  onClose,
  onAdjust,
  overlay = false,
}: {
  id: string
  plan: ChatPlan
  queued: QueuedChatInstruction[]
  busy: boolean
  needsApproval: boolean
  approvals: ReactNode
  onAction: (action: string, id?: string) => Promise<void>
  onClose: () => void
  onAdjust: () => void
  overlay?: boolean
}) {
  const mobile = useMediaQuery('(max-width: 1179px)')
  const [showDetails, setShowDetails] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (action: string, key?: string) => {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      await onAction(action, key)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setPending(false)
    }
  }
  const label = planLabel(plan, busy, needsApproval)
  const progress = planProgress(plan)
  const body = (
    <>
      <div className="sky-plan-scroll">
        <div className="sky-plan-intro">
          <span className="sky-plan-eyebrow">{label}</span>
          <h2>{plan.title}</h2>
          {showDetails && <p>{plan.outcome}</p>}
          <div
            className="sky-plan-progress"
            role="progressbar"
            aria-label="Plan progress"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <div className="sky-plan-summary">
            <p className="sky-plan-count">
              {progress.done} of {progress.total} items finished
            </p>
            <Button
              size="compact-xs"
              variant="primary-quiet"
              aria-expanded={showDetails}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
          </div>
        </div>
        {showDetails && plan.status === 'paused' && plan.note && (
          <p className="sky-plan-note" role="status">
            {plan.note}
          </p>
        )}
        {(plan.attention || needsApproval) && (
          <section className="sky-plan-attention" aria-label="Needs you">
            <h3>Needs you</h3>
            {plan.attention && (
              <>
                <p>{plan.attention.message}</p>
                {plan.attention.kind === 'browser' && (
                  <p className="sky-plan-hint">
                    {plan.attention.native
                      ? 'Use the sign-in dialog on the Mac running Sky. Sky continues automatically when sign-in finishes.'
                      : 'Use the browser on the computer running Sky. Complete sign-in there, then continue here.'}
                  </p>
                )}
                <Button
                  variant="primary"
                  disabled={plan.attention.native}
                  loading={pending}
                  onClick={() => void act('continue', plan.attention!.id)}
                >
                  {plan.attention.native
                    ? 'Waiting for sign-in…'
                    : plan.attention.kind === 'browser'
                      ? 'I’ve finished — continue'
                      : 'I’m ready — continue'}
                </Button>
              </>
            )}
            {approvals}
          </section>
        )}
        <ol className="sky-plan-steps">
          {plan.steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <ItemMark item={step} />
              <div className="sky-plan-step-body">
                <h3>{step.title}</h3>
                {(showDetails || step.status === 'working' || step.status === 'blocked') && (
                  <span className="sky-plan-step-status">
                    {step.status === 'working' && plan.status === 'paused' ? 'Paused here' : statusText[step.status]}
                  </span>
                )}
                {showDetails && step.detail && <p>{step.detail}</p>}
                {step.items.length > 0 && (
                  <details>
                    <summary>
                      {step.items.filter((item) => ['done', 'skipped'].includes(item.status)).length} of{' '}
                      {step.items.length} items <span aria-hidden="true">⌄</span>
                    </summary>
                    <ul>
                      {step.items.map((item) => (
                        <li key={item.id}>
                          <ItemMark item={item} />
                          <div>
                            <strong>{item.title}</strong>
                            {showDetails && item.detail && <p>{item.detail}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
        {plan.artifacts.length > 0 && (
          <section className="sky-plan-files">
            <h3>Files & results</h3>
            <ul>
              {plan.artifacts.map((artifact, index) => (
                <li key={`${artifact.evidence}:${artifact.location}`}>
                  <a
                    href={
                      artifact.location.startsWith('https://')
                        ? artifact.location
                        : `/chat/${encodeURIComponent(id)}/plan/files/${index}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {artifact.label} <span aria-hidden="true">↗</span>
                  </a>
                  {showDetails && <span>{artifact.location}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {showDetails && plan.finalCheck && (
          <section className="sky-plan-check">
            <h3>Final check</h3>
            <p>{plan.finalCheck}</p>
          </section>
        )}
        {showDetails && plan.note && plan.status !== 'paused' && <p className="sky-plan-note">{plan.note}</p>}
        {queued.length > 0 && (
          <section className="sky-plan-queued">
            <h3>Next instructions</h3>
            {showDetails && (
              <p>Sky reads new instructions after the current tool. Paused instructions wait until you send them.</p>
            )}
            {queued.map((entry) => (
              <div key={entry.id}>
                <p>{entry.message}</p>
                {entry.held && (
                  <Button size="xs" disabled={pending} onClick={() => void act('send-instruction', entry.id)}>
                    Send now
                  </Button>
                )}
                <Button size="xs" disabled={pending} onClick={() => void act('remove-instruction', entry.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>
      <footer className="sky-plan-footer">
        {error && <p role="alert">{error}</p>}
        {plan.status !== 'complete' && (
          <Button
            variant="primary"
            loading={pending}
            disabled={busy && plan.status === 'paused'}
            onClick={() => void act(busy ? 'pause' : 'resume')}
          >
            {busy
              ? plan.status === 'paused'
                ? 'Pausing…'
                : 'Pause'
              : plan.status === 'draft'
                ? 'Start plan'
                : 'Resume'}
          </Button>
        )}
        <Button onClick={onAdjust}>Adjust in chat</Button>
      </footer>
    </>
  )
  if (mobile || overlay)
    return (
      <Drawer
        opened
        onClose={onClose}
        position={mobile ? 'bottom' : 'right'}
        size={mobile ? '92dvh' : 430}
        title="Plan"
        classNames={{ content: 'sky-plan-drawer', body: 'sky-plan-drawer-body', header: 'sky-plan-drawer-head' }}
      >
        <div id="sky-chat-plan" className="sky-plan-content">
          {body}
        </div>
      </Drawer>
    )
  return (
    <aside id="sky-chat-plan" className="sky-plan-panel" aria-label="Plan">
      <header>
        <h2>Plan</h2>
        <ActionIcon aria-label="Close plan" onClick={onClose}>
          ×
        </ActionIcon>
      </header>
      {body}
    </aside>
  )
}
