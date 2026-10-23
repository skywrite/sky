import type OpenAI from 'openai'
import { SidebandWS } from 'openai/resources/live/sideband/ws'
import type { LiveSessionAnswer, VoiceToolOutput } from './mod.ts'

/** Large document results and continuation use one ordered server connection, outside SCTP's frame limit. */
export function liveBackend(client: OpenAI, sessionId: string): NonNullable<LiveSessionAnswer['backend']> {
  let socket: SidebandWS | undefined
  let ready: Promise<void> | undefined
  let failure: Error | undefined
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectReady: ((error: Error) => void) | undefined
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
      socket = new SidebandWS(client, { session_id: sessionId }, { reconnect: null })
      timer = setTimeout(() => {
        failure = new Error('The voice tool connection timed out. Start a new call.')
        reject(failure)
        socket?.close()
      }, 15_000)
      socket.socket.on('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        failure = new Error(error.message)
        reject(failure)
      })
      socket.on('close', () => {
        clearTimeout(timer)
        failure ??= new Error('The voice tool connection closed. Start a new call.')
        reject(failure)
      })
    }))
  const send = async (event: Parameters<SidebandWS['send']>[0]) => {
    await connect()
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
    close: () => {
      closed = true
      clearTimeout(timer)
      rejectReady?.(new Error('The voice session has ended.'))
      socket?.close()
    },
  }
}
