import { useCallback, useEffect, useState } from 'react'
import type { SlackCaptureChange, SlackCaptureSettings } from '#service/handler/settings/slackCapture.ts'
import { refusalOf } from './settingsBlocks.tsx'
import { API, postJson } from './settingsConnections.tsx'

const URL = `${API}/slack/capture-automation`

export function useSlackCaptureAutomation() {
  const [settings, setSettings] = useState<SlackCaptureSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    const response = await fetch(URL).catch(() => null)
    const refusal = await refusalOf(response)
    setError(refusal)
    if (response?.ok) setSettings((await response.json()) as SlackCaptureSettings)
  }, [])
  useEffect(() => {
    void reload()
    const refresh = () => void reload()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [reload])
  const change = useCallback(async (update: SlackCaptureChange) => {
    setBusy(true)
    try {
      const response = await postJson(URL, update)
      const refusal = await refusalOf(response)
      setError(refusal)
      if (response?.ok) {
        setSettings((await response.json()) as SlackCaptureSettings)
        window.dispatchEvent(new Event('sky-automations-changed'))
      }
    } finally {
      setBusy(false)
    }
  }, [])
  return { settings, error, busy, reload, change }
}
