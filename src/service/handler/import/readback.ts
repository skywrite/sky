/**
 * What a dropped file is, read before anything runs: instant and local.
 *
 * A transcript is parsed for its length, speakers and turns; a notetaker's
 * text for its stamped turns; a recording only for its size here — its
 * length comes from the file's own container, which the host probes. The
 * result is what the confirm dialog says back, and the refusals are the
 * sentences a file that cannot be imported gets instead of a wait.
 */

import * as path from 'node:path'
import { isRtf, stampedDurationMinutes, turnStamps } from '#commands/all/audio/transcript/lib/plainText.ts'
import SRT from '#commands/all/audio/transcript/lib/SRT/mod.ts'
import ZoomVTT from '#commands/all/audio/transcript/lib/ZoomVTT/mod.ts'

export type ImportKind = 'meeting' | 'journal' | 'note' | 'message' | 'event'
export type ImportSource = 'transcript' | 'text' | 'audio'

export const KINDS: ImportKind[] = ['meeting', 'journal', 'note', 'message', 'event']

export const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.flac', '.webm', '.mp4', '.caf']

/** The transcription request cap; a longer recording is refused up front, not after a wait. */
export const AUDIO_LIMIT_BYTES = 25 * 1024 * 1024

export interface ReadBack {
  source: ImportSource
  /** The kinds this file may be filed as — a transcript is a meeting, a recording could be anything */
  kinds: ImportKind[]
  /** One line: "Zoom transcript · 47 minutes · 212 turns" */
  summary: string
  /** A second line when there is one: the speakers */
  detail: string | null
  durationMinutes: number | null
  /** The time of day the transcript began, in seconds since midnight, when its cues stamp the clock; null when they count from zero */
  clockStartSeconds: number | null
  speakers: string[]
  /** Why the file cannot be imported, in a sentence; null when it can */
  refusal: string | null
}

/** Which door family a file name points at, or null for a file sky does not take. */
export function sourceOf(name: string): ImportSource | null {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.vtt') return 'transcript'
  if (ext === '.txt') return 'text'
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  return null
}

/** "47 minutes", "4 min 12 s", "under a minute" */
export function lengthLabel(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  if (seconds < 60) return 'under a minute'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes >= 10 || rest === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  return `${minutes} min ${rest} s`
}

function refused(source: ImportSource, refusal: string): ReadBack {
  return {
    source,
    kinds: [],
    summary: '',
    detail: null,
    durationMinutes: null,
    clockStartSeconds: null,
    speakers: [],
    refusal,
  }
}

/** A .vtt: Zoom's transcript, or a captioner's headerless one, read for what the confirm dialog says back. */
export function readTranscript(text: string, name: string): ReadBack {
  if (!ZoomVTT.isVtt(text)) {
    const why = SRT.isSrt(text) ? 'is an SRT file, which sky does not take yet' : 'is not a WebVTT transcript'
    return refused('transcript', `${name} ${why}.`)
  }
  const vtt = ZoomVTT.parse(text)
  const minutes = vtt.durationMinutes
  const speakers = vtt.speakers
  const length = minutes === null ? null : lengthLabel(minutes * 60)
  const zoom = vtt.hasHeader && vtt.looksLikeZoomDialect
  const parts = [zoom ? 'Zoom transcript' : 'Transcript', length, `${vtt.turns.length} turns`]
  return {
    source: 'transcript',
    kinds: ['meeting'],
    summary: parts.filter((p): p is string => Boolean(p)).join(' · '),
    detail: speakers.length > 0 ? speakers.join(', ') : null,
    durationMinutes: minutes,
    clockStartSeconds: vtt.hasHeader ? null : vtt.startSeconds,
    speakers,
    refusal: null,
  }
}

/** A .txt: a notetaker's copy of speaker lines, and nothing wrapped. */
export function readText(text: string, name: string): ReadBack {
  if (ZoomVTT.isVtt(text)) return refused('text', `${name} is a WebVTT transcript — save it as .vtt.`)
  if (SRT.isSrt(text)) return refused('text', `${name} is an SRT file, which sky does not take yet.`)
  if (isRtf(text)) return refused('text', `${name} is RTF, not plain text. Convert it to .txt first.`)
  if (!text.trim()) return refused('text', `${name} is empty.`)
  const stamps = turnStamps(text)
  const minutes = stampedDurationMinutes(stamps)
  const length = minutes === null ? null : lengthLabel(minutes * 60)
  const parts = ['Notetaker text', length, stamps.length > 0 ? `${stamps.length} stamped turns` : null]
  return {
    source: 'text',
    kinds: ['meeting'],
    summary: parts.filter((p): p is string => Boolean(p)).join(' · '),
    detail: null,
    durationMinutes: minutes,
    clockStartSeconds: null,
    speakers: [],
    refusal: null,
  }
}

/** A recording: its length from the container when the host could read it, its size always. */
export function readAudio(sizeBytes: number, durationSeconds: number | null): ReadBack {
  if (sizeBytes > AUDIO_LIMIT_BYTES) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(0)
    return refused('audio', `The recording is ${mb} MB, over the 25 MB limit. Trim it, or record shorter parts.`)
  }
  const length = lengthLabel(durationSeconds)
  return {
    source: 'audio',
    kinds: [...KINDS],
    summary: ['Voice memo', length].filter((p): p is string => Boolean(p)).join(' · '),
    detail: null,
    durationMinutes: durationSeconds === null ? null : Math.round((durationSeconds / 60) * 10) / 10,
    clockStartSeconds: null,
    speakers: [],
    refusal: null,
  }
}

/** A file sky does not take, in a sentence. */
export function readUnknown(name: string): ReadBack {
  const ext = path.extname(name).toLowerCase() || 'that kind of'
  return refused(
    'text',
    `Sky doesn't take ${ext} files. Drop a Zoom transcript (.vtt), a voice memo, or a notetaker's .txt.`,
  )
}
