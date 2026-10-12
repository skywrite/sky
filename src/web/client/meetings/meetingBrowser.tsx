import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import type { CalendarBrowserState } from '#lib/calendarScheduler/types.ts'
import { meetingRequest } from './meetingRequest.ts'
import './meetingBrowser.css'

const pending = (state?: CalendarBrowserState['state']) =>
  ['checking', 'opening', 'waiting', 'busy'].includes(state ?? '')

export function useMeetingBrowser(account: string, enabled: boolean, failedAttempt?: string) {
  const [value, setValue] = useState<CalendarBrowserState | null>(null)
  const [refresh, setRefresh] = useState(0)
  const sequence = useRef(0)
  const working = useRef(false)
  const checkedKey = useRef('')
  const key = `${account}:${failedAttempt ?? ''}`
  const state = checkedKey.current === key ? value : null
  const update = (next: CalendarBrowserState) => {
    checkedKey.current = key
    setValue(next)
  }
  useEffect(() => {
    const current = ++sequence.current
    if (!enabled || !account) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let force = !!failedAttempt
    const poll = async () => {
      try {
        const next = await meetingRequest<CalendarBrowserState>(
          force ? 'browser/check' : `browser?account=${encodeURIComponent(account)}`,
          force ? { account } : undefined,
          controller.signal,
        )
        force = false
        if (controller.signal.aborted || current !== sequence.current) return
        update(next)
        if (pending(next.state)) timer = setTimeout(() => void poll(), 1500)
      } catch (error) {
        if (!controller.signal.aborted && current === sequence.current)
          update({
            account,
            state: 'failed',
            message: error instanceof Error ? error.message : 'Could not check Google sign-in.',
          })
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [account, enabled, refresh, failedAttempt])

  const act = async (action: 'sign-in' | 'check' | 'cancel') => {
    if (working.current) return
    working.current = true
    const current = ++sequence.current
    update({ account, state: action === 'sign-in' ? 'opening' : 'checking' })
    try {
      const next = await meetingRequest<CalendarBrowserState>(`browser/${action}`, { account })
      if (current === sequence.current) {
        update(next)
        setRefresh((count) => count + 1)
      }
    } catch (error) {
      if (current === sequence.current)
        update({
          account,
          state: 'failed',
          message: error instanceof Error ? error.message : 'Could not open Google sign-in.',
        })
    } finally {
      working.current = false
    }
  }
  return { enabled, account, state, ready: !enabled || state?.state === 'signed_in', act }
}

export function MeetingGoogleSignIn({ connection }: { connection: ReturnType<typeof useMeetingBrowser> }) {
  const { enabled, account, state, act } = connection
  if (!enabled || !account) return null
  const waiting = state?.state === 'opening' || state?.state === 'waiting'
  const checking = !state || state.state === 'checking' || state.state === 'busy'
  return (
    <div className="sky-meeting-browser" role="region" aria-label="Google browser sign-in">
      <div role="status">
        <strong>
          {state?.state === 'signed_in'
            ? 'Signed in to Google'
            : state?.state === 'opening'
              ? 'Opening Google sign-in…'
              : waiting
                ? 'Finish signing in to Google'
                : checking
                  ? 'Checking Google sign-in…'
                  : state?.state === 'failed'
                    ? 'Google sign-in needs attention'
                    : 'Google sign-in required'}
        </strong>
        <p>
          {state?.message ??
            (state?.state === 'signed_in'
              ? `Scheduling account: ${account}.`
              : waiting
                ? `Sign in as ${account} in the window on the computer running Sky. Your draft stays here.`
                : checking
                  ? 'Checking the browser Sky uses for Calendar.'
                  : `Sign in as ${account}. Opens a window on the computer running Sky; your draft will be preserved.`)}
        </p>
      </div>
      {waiting ? (
        <Button size="sm" onClick={() => void act('cancel')}>
          Cancel sign-in
        </Button>
      ) : (
        !checking &&
        state?.state !== 'signed_in' && (
          <div className="sky-meeting-browser-actions">
            <Button size="sm" variant="primary" onClick={() => void act('sign-in')}>
              Sign in to Google
            </Button>
            <Button size="sm" onClick={() => void act('check')}>
              Check again
            </Button>
          </div>
        )
      )}
    </div>
  )
}
