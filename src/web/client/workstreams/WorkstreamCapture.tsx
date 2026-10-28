import { Loader, Modal, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useRef, type TouchEvent } from 'react'
import { CaptureNavigation } from './CaptureNavigation.tsx'
import { CaptureProgress } from './CaptureProgress.tsx'
import { CaptureQuestion } from './CaptureQuestion.tsx'
import { CaptureReview } from './CaptureReview.tsx'
import { useCaptureFlow } from './useCaptureFlow.ts'
import './WorkstreamCapture.css'

export function WorkstreamCapture({
  opened,
  initialIntent,
  parentId,
  busy,
  onClose,
  onCreate,
  onOpenWeek,
}: {
  opened: boolean
  initialIntent: string
  parentId?: string
  busy: boolean
  onClose: () => void
  onCreate: (input: unknown) => Promise<void>
  onOpenWeek: (id: string) => void
}) {
  const touch = useMediaQuery('(pointer: coarse)') ?? false
  const flow = useCaptureFlow({ opened, initialIntent, parentId, busy, touch, onClose, onCreate, onOpenWeek })
  const { intent, steps, cursor, thinking, saving, error, locked, question, ready, answerInput } = flow
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const touchStart = (event: TouchEvent) => {
    swipe.current = null
    if (
      locked ||
      thinking ||
      event.touches.length !== 1 ||
      (event.target as HTMLElement).closest('input, textarea, button, a, nav, details, [contenteditable], label')
    )
      return
    const point = event.touches[0]!
    swipe.current = { x: point.clientX, y: point.clientY }
  }
  const touchMove = (event: TouchEvent) => {
    if (!swipe.current) return
    const point = event.touches[0]
    if (
      !point ||
      event.touches.length !== 1 ||
      Math.abs(point.clientY - swipe.current.y) > Math.max(24, Math.abs(point.clientX - swipe.current.x))
    )
      swipe.current = null
  }
  const touchEnd = (event: TouchEvent) => {
    const start = swipe.current
    swipe.current = null
    const end = event.changedTouches[0]
    if (!start || !end || event.touches.length) return
    const dx = end.clientX - start.x
    if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(end.clientY - start.y) * 2) flow.move(cursor + (dx < 0 ? 1 : -1))
  }

  return (
    <Modal
      opened={opened}
      onClose={flow.close}
      title={flow.title}
      size="md"
      withCloseButton={!saving}
      closeOnEscape={!saving}
      closeOnClickOutside={!thinking && !saving}
    >
      <div
        className="sky-workstream-capture-flow"
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onTouchCancel={() => {
          swipe.current = null
        }}
      >
        <CaptureProgress labels={flow.labels} cursor={cursor} locked={locked} onMove={flow.move} />
        {thinking ? (
          <div className="sky-workstream-capture-reading" role="status">
            <p className="sky-workstream-capture-intent">{intent}</p>
            <div className="sky-workstream-capture-status">
              <Loader size="sm" aria-hidden="true" />
              <p>Reading relevant notes and finding what still needs your input.</p>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <p className="sky-workstream-capture-error" role="alert">
                {error}
              </p>
            )}
            {!cursor && (
              <Textarea
                ref={answerInput}
                aria-label="What do you want to get done?"
                placeholder="Tell Sky what you have in mind…"
                autosize
                minRows={3}
                maxRows={7}
                maxLength={20000}
                value={intent}
                onChange={(event) => flow.changeIntent(event.currentTarget.value)}
                onKeyDown={flow.keySubmit}
                enterKeyHint={touch ? 'enter' : 'send'}
                disabled={locked}
              />
            )}
            {question && <CaptureQuestion flow={flow} touch={touch} />}
            {ready && <CaptureReview flow={flow} />}
          </>
        )}
        <CaptureNavigation flow={flow} busy={busy} />
        {touch && steps.length > 0 && <p className="sky-workstream-capture-swipe-hint">Swipe to revisit a step.</p>}
      </div>
    </Modal>
  )
}
