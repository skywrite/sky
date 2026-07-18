/**
 * Parser for Zoom meeting-transcript VTT files — the only VTT dialect this
 * notebook ingests. Zoom writes numbered cues with `Display Name: text`
 * payloads and no styling/voice markup. If transcripts from another tool
 * (Teams uses `<v Name>` voice tags) ever show up, revisit the scope — see
 * `looksLikeZoomDialect`, which callers use to warn at runtime.
 *
 * Parsing is lenient: unrecognized blocks and malformed cues are skipped,
 * never thrown on — a bad cue must not sink the transcript pipeline.
 */

export interface ZoomVTTCue {
  /** Numeric cue identifier when present (Zoom numbers every cue) */
  index: number | null
  startSeconds: number
  endSeconds: number
  /** Display name from Zoom's `Name: text` payload convention, null when absent */
  speaker: string | null
  text: string
}

export interface ZoomVTTTurn {
  speaker: string | null
  startSeconds: number
  endSeconds: number
  text: string
}

const TIMESTAMP_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s+-->\s+(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/
const SPEAKER_RE = /^([^:]{1,64}?):\s+(.*)$/s

function timeToSeconds(t: string): number {
  const [main, frac = '0'] = t.replace(',', '.').split('.')
  const parts = main.split(':').map(Number)
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]]
  return h * 3600 + m * 60 + s + Number(`0.${frac}`)
}

function secondsToHMS(total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export default class ZoomVTT {
  readonly cues: ZoomVTTCue[]
  /** False when Teams-style voice tags were seen — speaker detection is then unreliable */
  readonly looksLikeZoomDialect: boolean

  private constructor(cues: ZoomVTTCue[], looksLikeZoomDialect: boolean) {
    this.cues = cues
    this.looksLikeZoomDialect = looksLikeZoomDialect
  }

  /** Cheap sniff: is this text a WebVTT file at all? */
  static isVtt(raw: string): boolean {
    return raw.replace(/^﻿/, '').trimStart().startsWith('WEBVTT')
  }

  static parse(raw: string): ZoomVTT {
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/)
    const cues: ZoomVTTCue[] = []
    let hasVoiceTags = false

    let i = 0
    while (i < lines.length) {
      const line = lines[i].trim()

      if (line === '' || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
        i++
        continue
      }

      // Optional numeric cue id directly above the timestamp line
      let index: number | null = null
      let tsLine = line
      if (/^\d+$/.test(line) && i + 1 < lines.length && TIMESTAMP_RE.test(lines[i + 1].trim())) {
        index = Number(line)
        i++
        tsLine = lines[i].trim()
      }

      if (!TIMESTAMP_RE.test(tsLine)) {
        i++
        continue
      }

      const [startRaw, endRaw] = tsLine.split('-->')
      const startSeconds = timeToSeconds(startRaw.trim())
      // Ignore cue settings after the end time ("align:start position:0%")
      const endSeconds = timeToSeconds(endRaw.trim().split(/\s+/)[0])
      i++

      const payload: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        payload.push(lines[i].trim())
        i++
      }

      let text = payload.join(' ')
      if (text.includes('<v')) hasVoiceTags = true
      text = text.replace(/<[^>]*>/g, '')

      let speaker: string | null = null
      const m = text.match(SPEAKER_RE)
      if (m) {
        speaker = m[1].trim()
        text = m[2]
      }

      if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
        cues.push({ index, startSeconds, endSeconds, speaker, text })
      }
    }

    return new ZoomVTT(cues, !hasVoiceTags)
  }

  /** Unique speakers in order of first appearance */
  get speakers(): string[] {
    const seen = new Set<string>()
    for (const cue of this.cues) {
      if (cue.speaker) seen.add(cue.speaker)
    }
    return [...seen]
  }

  /**
   * Consecutive cues from the same speaker merged into one turn. Cues with no
   * speaker prefix are treated as continuations of the current turn.
   */
  get turns(): ZoomVTTTurn[] {
    const turns: ZoomVTTTurn[] = []
    for (const cue of this.cues) {
      const last = turns[turns.length - 1]
      if (last && (cue.speaker === last.speaker || cue.speaker === null)) {
        if (cue.text) last.text = last.text ? `${last.text} ${cue.text}` : cue.text
        last.endSeconds = cue.endSeconds
      } else {
        turns.push({ speaker: cue.speaker, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text: cue.text })
      }
    }
    return turns
  }

  /** Meeting length from the latest cue end time, rounded to whole minutes */
  get durationMinutes(): number | null {
    if (this.cues.length === 0) return null
    const end = this.cues.reduce((max, c) => Math.max(max, c.endSeconds), 0)
    return Math.round(end / 60)
  }

  /**
   * Compact model-facing text: one paragraph per speaker turn, optionally
   * anchored with the turn's start time. This is what strips the ~25-30%
   * cue-number/timestamp overhead out of raw Zoom VTTs.
   */
  toTurnText(options: { timestamps?: boolean } = {}): string {
    const { timestamps = true } = options
    return this.turns
      .map((t) => {
        const stamp = timestamps ? `[${secondsToHMS(t.startSeconds)}] ` : ''
        const name = t.speaker ? `${t.speaker}: ` : ''
        return `${stamp}${name}${t.text}`
      })
      .join('\n\n')
  }
}
