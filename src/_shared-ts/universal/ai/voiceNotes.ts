/**
 * Notes the service adds to a live voice call on its own (a changed day list, a finished background
 * research) carry an event_id with this prefix. Live reports a rejected command as an `error` event
 * naming that id, and the browser and the service both read it: the service logs a rejected note
 * and the browser skips it, and only errors in the conversation itself end the call.
 */
export const VOICE_NOTE_EVENT_PREFIX = 'sky-note-'

interface LiveErrorEvent {
  type?: string
  client_event_id?: string
  error?: { client_event_id?: string } | null
}

/** Whether a Live error event answers one of the service's own notes rather than the conversation. */
export function isVoiceNoteError(event: LiveErrorEvent | null | undefined): boolean {
  const id = event?.error?.client_event_id ?? event?.client_event_id
  return typeof id === 'string' && id.startsWith(VOICE_NOTE_EVENT_PREFIX)
}
