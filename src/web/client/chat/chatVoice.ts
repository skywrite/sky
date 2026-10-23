import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoice } from '../voice/voice.tsx'
import type { Chat } from './chat.tsx'

/** Own the live segment until the chat service has kept it and read it back. */
export function useChatVoice(chat: Chat) {
  const [callId] = useState(() => crypto.randomUUID())
  const voice = useVoice(callId)
  const [preparing, setPreparing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const after = useRef<number | null>(null)
  const archived = useRef(true)
  const pending = useRef<Promise<boolean> | null>(null)
  const mounted = useRef(true)
  const starting = useRef(false)
  const current = useRef({ chat, voice })
  current.current = { chat, voice }

  const sync = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current
    if (archived.current || after.current === null) return Promise.resolve(true)
    const { chat, voice } = current.current
    const settings = chat.state.settings
    if (!settings) return Promise.resolve(false)
    const body = JSON.stringify({
      after: after.current,
      turns: voice.latest().turns,
      profile: settings.model.current,
      effort: settings.effort ?? 'default',
      contextTokens: settings.contextTokens,
      saves: settings.saves,
    })
    if (mounted.current) setSyncing(true)
    const saving = (async () => {
      try {
        const response = await fetch(`/chat/${chat.state.id}/voice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: new TextEncoder().encode(body).length < 60_000,
        })
        const result = (await response.json()) as { message?: string; appended?: number }
        if (!response.ok) throw new Error(result.message ?? 'Could not keep the voice transcript.')
        if (mounted.current)
          await chat.reload().catch((error) => {
            if (result.appended) throw error
          })
        archived.current = true
        if (mounted.current) {
          setError(null)
          setVisible(false)
        }
        return true
      } catch (error) {
        if (mounted.current) setError((error as Error).message)
        return false
      } finally {
        pending.current = null
        if (mounted.current) setSyncing(false)
      }
    })()
    pending.current = saving
    return saving
  }, [])

  const end = useCallback(async () => {
    await current.current.voice.end()
    return sync()
  }, [sync])

  const start = useCallback(async () => {
    if (starting.current || pending.current || chat.state.phase !== 'idle' || !chat.state.settings) return
    starting.current = true
    // Unlock local lip analysis in the click, before preflight network awaits.
    void voice.audioMotion.start()
    setPreparing(true)
    setError(null)
    try {
      if (!(await sync())) return
      const response = await fetch(`/chat/${chat.state.id}`)
      if (!mounted.current) return
      if (!response.ok && response.status !== 404) throw new Error('Could not open this chat for voice. Try again.')
      const body = response.ok ? ((await response.json()) as { turns: unknown[]; busy?: boolean }) : { turns: [] }
      if (!mounted.current) return
      const latestChat = current.current.chat
      if (body.busy || body.turns.length % 2 !== 0 || body.turns.length !== latestChat.state.turns.length) {
        throw new Error('Wait for the current reply, or retry an interrupted message, before starting voice.')
      }
      after.current = body.turns.length
      archived.current = false
      setVisible(true)
      const transcript = latestChat.state.turns
        .map((turn) => `${turn.role === 'user' ? 'User' : 'Sky'}: ${turn.content}`)
        .join('\n\n')
      const context = transcript
        ? `Conversation already in progress. These are previous messages, not new requests.\n${transcript.length > 60_000 ? '[Earlier messages omitted.]\n' : ''}${transcript.slice(-60_000)}`
        : ''
      setPreparing(false)
      const settings = latestChat.state.settings!
      await voice.start(context, {
        id: latestChat.state.id,
        after: after.current,
        profile: settings.model.current,
        effort: settings.effort ?? 'default',
        contextTokens: settings.contextTokens,
        saves: settings.saves,
      })
    } catch (error) {
      if (mounted.current) setError((error as Error).message)
    } finally {
      starting.current = false
      if (!['starting', 'live', 'ending'].includes(voice.latest().phase)) voice.audioMotion.stop()
      if (mounted.current) setPreparing(false)
    }
  }, [chat, sync, voice])

  useEffect(() => {
    if (voice.state.phase === 'failed') void voice.end().then(sync)
  }, [voice.state.phase, sync])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void current.current.voice.end().then(sync)
    }
  }, [sync])

  const active = voice.state.phase === 'starting' || voice.state.phase === 'live' || voice.state.phase === 'ending'
  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        await current.current.chat.reload()
      } catch {
        /* The next poll can recover. */
      }
      if (!stopped)
        timer = setTimeout(() => {
          void refresh()
        }, 2000)
    }
    timer = setTimeout(() => {
      void refresh()
    }, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [active])
  return {
    voice,
    active,
    preparing,
    syncing,
    error,
    unsaved: Boolean(error) && !archived.current,
    visible,
    start,
    end,
    retry: () => (archived.current ? start() : sync()),
  }
}
