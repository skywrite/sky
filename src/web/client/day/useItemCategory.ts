import { useEffect, useRef, useState } from 'react'

type CategoryStatus = 'idle' | 'pending' | 'unavailable'

/** Each new draft gets suggestions until the person chooses a category themselves. */
export function useItemCategory({
  text,
  opened,
  busy,
  ymd,
}: {
  text: string
  opened: boolean
  busy: boolean
  ymd: string
}) {
  const [category, setCategory] = useState('Professional')
  const [status, setStatus] = useState<CategoryStatus>('idle')
  const manual = useRef(false)
  const request = useRef<AbortController | null>(null)
  const current = useRef({ text, opened, busy, ymd })
  current.current = { text, opened, busy, ymd }

  useEffect(() => {
    manual.current = false
    setCategory('Professional')
    setStatus('idle')
  }, [opened, ymd])

  useEffect(() => {
    setStatus('idle')
    const value = text.trim()
    if (!opened || busy || !value || manual.current) return
    const controller = new AbortController()
    request.current = controller
    const active = () =>
      !controller.signal.aborted &&
      !manual.current &&
      current.current.opened &&
      !current.current.busy &&
      current.current.text === text &&
      current.current.ymd === ymd
    const timer = setTimeout(async () => {
      if (!active()) return
      setStatus('pending')
      try {
        const response = await fetch(`/day/${ymd}/item/category`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: value }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        })
        const data = response.ok ? ((await response.json()) as { category?: unknown }) : null
        if (!active()) return
        if (data?.category === 'Personal' || data?.category === 'Professional') {
          setCategory(data.category)
          setStatus('idle')
        } else setStatus('unavailable')
      } catch {
        if (active()) setStatus('unavailable')
      }
    }, 600)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text, opened, busy, ymd])

  const chooseCategory = (value: string) => {
    manual.current = true
    request.current?.abort()
    setCategory(value)
    setStatus('idle')
  }
  return { category, status, chooseCategory }
}
