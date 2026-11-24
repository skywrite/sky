import { useCallback, useEffect, useRef, useState } from 'react'
import type { NeedsResponseItem } from '#lib/needsResponse/types.ts'

const POLL_MS = 60_000
const UNDO_MS = 8_000
const REMOVE_ANIM_MS = 220

export type NeedsResponseDismissKind = 'responded' | 'dismissed'

export interface NeedsResponseUndo {
  key: string
  id: string
  sender: string
  how: NeedsResponseDismissKind
}

export function useNeedsResponse(enabled: boolean) {
  const [items, setItems] = useState<NeedsResponseItem[]>([])
  const [removing, setRemoving] = useState<Record<string, boolean>>({})
  const [undo, setUndo] = useState<NeedsResponseUndo | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoSeq = useRef(0)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/day/needs-response')
      if (!response.ok) return
      const data = (await response.json()) as { items?: NeedsResponseItem[] }
      if (Array.isArray(data.items)) setItems(data.items)
    } catch {
      // Transient service error: keep existing items intact.
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      return
    }
    let alive = true
    const refresh = () => {
      if (!alive || document.visibilityState === 'hidden') return
      void load()
    }
    void load()
    const timer = setInterval(refresh, POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, load])

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
    }
  }, [])

  const dismissUndo = useCallback(() => {
    setUndo(null)
    if (undoTimer.current) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
  }, [])

  const clearItem = useCallback(async (item: NeedsResponseItem, how: NeedsResponseDismissKind) => {
    setOpenError(null)
    setRemoving((prev) => ({ ...prev, [item.id]: true }))
    try {
      const [response] = await Promise.all([
        fetch('/day/needs-response/dismiss', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: item.id, version: item.version }),
        }),
        new Promise((resolve) => setTimeout(resolve, REMOVE_ANIM_MS)),
      ])
      if (response.ok) {
        const data = (await response.json()) as { items?: NeedsResponseItem[] }
        if (Array.isArray(data.items)) setItems(data.items)
        const key = `${item.id}:${++undoSeq.current}`
        setUndo({ key, id: item.id, sender: item.sender, how })
        if (undoTimer.current) clearTimeout(undoTimer.current)
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
      }
    } finally {
      setRemoving((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    }
  }, [])

  const revertUndo = useCallback(async () => {
    if (!undo) return
    const targetId = undo.id
    dismissUndo()
    try {
      const response = await fetch('/day/needs-response/undismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: targetId }),
      })
      if (response.ok) {
        const data = (await response.json()) as { items?: NeedsResponseItem[] }
        if (Array.isArray(data.items)) setItems(data.items)
      }
    } catch {
      void load()
    }
  }, [undo, dismissUndo, load])

  const openInApp = useCallback(async (item: NeedsResponseItem) => {
    setOpenError(null)
    try {
      const response = await fetch('/day/needs-response/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setOpenError(data?.error ?? `Could not open ${item.source} right now.`)
      }
    } catch {
      setOpenError(`Could not open ${item.source} right now.`)
    }
  }, [])

  return { items, removing, undo, openError, clearItem, revertUndo, dismissUndo, openInApp }
}
