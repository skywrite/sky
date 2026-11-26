import { useCallback, useEffect, useRef, useState } from 'react'
import { appendDictation, type DictationView, EntryDictation } from './entryDictation.ts'

export interface DictationField {
  name: string
  text: string
  setText: (value: string) => void
  limit: number
}

const IDLE: DictationView & { field?: string } = { phase: 'idle', speech: '' }
export const ENTRY_TEXT_LIMIT = 4000

export function useEntryDictation(ymd: string, opened: boolean) {
  const active = useRef<EntryDictation | null>(null)
  const [view, setView] = useState(IDLE)
  const microphoneLevel = useCallback(() => active.current?.microphone.sample() ?? 0, [])

  useEffect(() => {
    if (!opened) {
      active.current?.cancel()
      active.current = null
      setView(IDLE)
    }
  }, [opened])
  useEffect(() => {
    setView(IDLE)
    return () => {
      active.current?.cancel()
      active.current = null
    }
  }, [ymd])

  const toggle = ({ name, text, setText, limit }: DictationField) => {
    if (active.current) return active.current.stop()
    const call = new EntryDictation(ymd, (next) => {
      if (active.current !== call) return
      const combined = appendDictation(text, next.speech)
      if (next.phase === 'idle') {
        active.current = null
        setText(combined)
      }
      setView({ ...next, field: name })
      if (next.phase === 'listening' && combined.length > limit) call.stop()
    })
    active.current = call
    void call.start()
  }
  return { ...view, active: view.phase !== 'idle', toggle, microphoneLevel, keepText: () => active.current?.finish() }
}

export type DayDictation = ReturnType<typeof useEntryDictation>
