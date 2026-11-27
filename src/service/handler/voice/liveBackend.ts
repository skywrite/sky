import type OpenAI from 'openai'
import { SidebandWS } from 'openai/resources/live/sideband/ws'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import { logger } from '#shared/log.ts'
import { isVoiceNoteError, VOICE_NOTE_EVENT_PREFIX } from '#universal/ai/voiceNotes.ts'
import type { LiveSessionAnswer, VoiceToolOutput } from './mod.ts'

const log = logger('voice')

/** Live accepts at most 500 tokens in one append; this many UTF-8 bytes stays under that in any script. */
export const NOTE_MAX_BYTES = 1200

/** Something the service tells a running call on its own, outside any tool result. */
export type VoiceNote =
  /** Silent context: a changed day list, a meeting that started */
  | { type: 'session.thinking.append'; content: string }
  /** Something to say aloud at a natural pause: findings that just arrived */
  | { type: 'session.commentary.append'; content: string }
  /** Evidence for the backend's later turns, without starting one */
  | { type: 'response.item.create'; item: ResponseInputItem }

function fitNote(content: string): string {
  const bytes = new TextEncoder().encode(content)
  if (bytes.length <= NOTE_MAX_BYTES) return content
  let end = NOTE_MAX_BYTES - 3
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return `${new TextDecoder().decode(bytes.subarray(0, end)).trimEnd()}...`
}

/**
 * The service's own ordered connection to the Live session: large document results and backend
 * continuations, which do not fit WebRTC's frame limit, and the notes the service adds on its own.
 * It attaches as soon as the session exists, so the first tool result does not wait for a handshake.
 */
export function liveBackend(client: OpenAI, sessionId: string): NonNullable<LiveSessionAnswer['backend']> {
  let socket: SidebandWS | undefined
  let ready: Promise<void> | undefined
  let failure: Error | undefined
  let opened = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectReady: ((error: Error) => void) | undefined
  let notes = 0
  const outputs = new Map<string, VoiceToolOutput>()
  const continuations = new Map<string, Promise<void>>()
  let sending = Promise.resolve()
  const connect = () =>
    (ready ??= new Promise<void>((resolve, reject) => {
      rejectReady = reject
      if (closed) {
        reject(new Error('The voice session has ended.'))
        return
      }
      const current = new SidebandWS(client, { session_id: sessionId }, { reconnect: null })
      socket = current
      // Events from a socket this connection has since let go of change nothing.
      const live = () => socket === current
      timer = setTimeout(() => {
        if (!live()) return
        failure = new Error('The voice tool connection timed out. Start a new call.')
        reject(failure)
        current.close()
      }, 15_000)
      current.socket.on('open', () => {
        if (!live()) return
        clearTimeout(timer)
        opened = true
        resolve()
      })
      current.on('error', (error) => {
        if (!live()) return
        // A rejected note is that note's failure alone; anything else ends the connection as before.
        const event = (error as { error?: Parameters<typeof isVoiceNoteError>[0] }).error
        if (isVoiceNoteError(event)) {
          log.warn('A voice note was not accepted: {message}', { message: error.message })
          return
        }
        clearTimeout(timer)
        failure = new Error(error.message)
        reject(failure)
      })
      current.on('close', () => {
        if (!live()) return
        clearTimeout(timer)
        failure ??= new Error('The voice tool connection closed. Start a new call.')
        reject(failure)
      })
    }))
  /** Forget an attempt that failed before ever opening, so the next connect starts a fresh one. */
  const forget = (attempt: Promise<void>) => {
    if (closed || opened || ready !== attempt) return
    const failed = socket
    socket = undefined
    ready = undefined
    failure = undefined
    failed?.close()
  }
  // Attach now. If this first attempt fails before opening, a send already waiting on it, or any later
  // one, tries once more on a fresh connection; once a connection has opened, its failure is final.
  const eager = connect()
  void eager.catch(() => forget(eager))
  const send = async (event: Parameters<SidebandWS['send']>[0]) => {
    const attempt = connect()
    try {
      await attempt
    } catch (error) {
      if (closed || opened) throw error
      forget(attempt)
      await connect()
    }
    if (closed || failure) throw failure ?? new Error('The voice session has ended.')
    socket!.send(event)
    if (failure) throw failure
  }
  return {
    output: async (callId, output) => {
      if (closed) throw new Error('The voice session has ended.')
      // A lost HTTP acknowledgement must not replace a completed action with a transport error.
      if (!outputs.has(callId)) outputs.set(callId, output)
    },
    resume: (callIds) => {
      const key = JSON.stringify(callIds)
      const previous = continuations.get(key)
      if (previous) return previous
      const continuation = sending.then(async () => {
        if (callIds.some((id) => !outputs.has(id))) throw new Error('Voice is still waiting for a tool result.')
        for (const callId of callIds)
          await send({
            type: 'response.item.create',
            item: { type: 'function_call_output', call_id: callId, output: outputs.get(callId)! },
          })
        await send({ type: 'response.create' })
        for (const callId of callIds) outputs.delete(callId)
      })
      continuations.set(key, continuation)
      sending = continuation.catch(() => {})
      return continuation
    },
    // Rides the same queue as continuations, so a note never lands between a continuation's outputs.
    note: (note: VoiceNote) => {
      const event_id = `${VOICE_NOTE_EVENT_PREFIX}${++notes}`
      const delivery = sending.then(() =>
        send(
          note.type === 'response.item.create'
            ? { ...note, event_id }
            : { type: note.type, content: fitNote(note.content), delegation_id: null, event_id },
        ),
      )
      sending = delivery.catch(() => {})
      return delivery
    },
    close: () => {
      closed = true
      clearTimeout(timer)
      rejectReady?.(new Error('The voice session has ended.'))
      socket?.close()
    },
  }
}
