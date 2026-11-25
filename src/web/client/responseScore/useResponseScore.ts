import { useCallback, useEffect, useState } from 'react'
import type { ResponseScore } from '#lib/needsResponse/earned.ts'

export type ResponseScoreState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; score: ResponseScore }

/** The response score, read on arrival and again whenever the page comes back into view. */
export function useResponseScore(): { state: ResponseScoreState; retry: () => void } {
  const [state, setState] = useState<ResponseScoreState>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      const response = await fetch('/day/needs-response/score')
      if (!response.ok) throw new Error(`Response score answered ${response.status}`)
      const score = (await response.json()) as ResponseScore
      setState({ status: 'ready', score })
    } catch {
      // A failed refresh keeps the score already on screen; only a first load fails visibly.
      setState((current) => (current.status === 'ready' ? current : { status: 'error' }))
    }
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void load()
  }, [load])

  return { state, retry }
}
