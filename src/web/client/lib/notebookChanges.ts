import type { NotebookChange } from '../../../service/notebookChanges.ts'

export type NotebookNotice = NotebookChange | { type: 'resume' }
const listeners = new Set<(notice: NotebookNotice) => void>()
let socket: WebSocket | null = null
let ready: Extract<NotebookChange, { type: 'ready' }> | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let teardown: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let pongDeadline: ReturnType<typeof setTimeout> | null = null
let retryDelay = 500

function notify(notice: NotebookNotice) {
  for (const listener of listeners) listener(notice)
}

function clearHeartbeat() {
  if (heartbeat) clearInterval(heartbeat)
  if (pongDeadline) clearTimeout(pongDeadline)
  heartbeat = null
  pongDeadline = null
}

function ping() {
  if (socket?.readyState !== WebSocket.OPEN || pongDeadline) return
  const current = socket
  current.send('ping')
  pongDeadline = setTimeout(() => current.close(), 10000)
}

function connect() {
  if (!listeners.size || socket) return
  if (retry) clearTimeout(retry)
  retry = null
  const url = new URL('/notebook/changes', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const current = new WebSocket(url)
  socket = current
  current.onopen = () => {
    if (socket !== current) return
    heartbeat = setInterval(ping, 20000)
  }
  current.onmessage = (event) => {
    if (socket !== current) return
    if (event.data === 'pong') {
      if (pongDeadline) clearTimeout(pongDeadline)
      pongDeadline = null
      return
    }
    try {
      const change = JSON.parse(event.data) as NotebookChange
      if (change.type === 'ready') {
        ready = change
        retryDelay = 500
        notify(change)
      } else if (change.type === 'changed') {
        notify(change)
      }
    } catch {
      current.close()
    }
  }
  current.onerror = () => current.close()
  current.onclose = () => {
    if (socket !== current) return
    socket = null
    ready = null
    clearHeartbeat()
    if (!listeners.size) return
    retry = setTimeout(() => {
      retry = null
      connect()
    }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 10000)
  }
}

function resume() {
  if (document.hidden) return
  notify({ type: 'resume' })
  if (!socket) {
    if (retry) clearTimeout(retry)
    retry = null
    connect()
  } else ping()
}

/** Components share one connection per tab, including across client-side navigation. */
export function subscribeNotebookChanges(listener: (notice: NotebookNotice) => void): () => void {
  if (teardown) clearTimeout(teardown)
  teardown = null
  const first = !listeners.size
  listeners.add(listener)
  if (first) {
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
  }
  if (ready) listener(ready)
  connect()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    // A route change replaces the subscriber in the same turn; retain its connection.
    teardown = setTimeout(() => {
      teardown = null
      if (listeners.size) return
      if (retry) clearTimeout(retry)
      retry = null
      clearHeartbeat()
      const current = socket
      socket = null
      ready = null
      current?.close()
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }, 0)
  }
}
