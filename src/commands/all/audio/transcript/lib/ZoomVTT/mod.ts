/**
 * Parser for meeting-transcript VTT files. Zoom's is the dialect this
 * notebook was built on: a `WEBVTT` header, numbered cues with
 * `Display Name: text` payloads, times counted from zero, no styling or
 * voice markup. Two departures are read as well. Teams-style `<v Name>`
 * voice tags are stripped — see `looksLikeZoomDialect`, which callers use
 * to warn at runtime. And the headerless dialect some live captioners save:
 * no `WEBVTT` line, no cue numbers, whole-second times that are the time of
 * day rather than an offset from the start — see `hasHeader`, which decides
 * where the length is measured from.
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

// The fraction of a second is optional: Zoom writes it, the headerless dialect does not.
const TIMESTAMP_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?\s+-->\s+(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?/
const BOM_RE = /^\uFEFF/

/** The text as the sniff sees it: no byte-order mark, no leading blank lines. */
function opening(raw: string): string {
  return raw.replace(BOM_RE, '').trimStart()
}
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
  /** False for the headerless dialect, whose cue times are the time of day rather than an offset from zero */
  readonly hasHeader: boolean

  private constructor(cues: ZoomVTTCue[], looksLikeZoomDialect: boolean, hasHeader: boolean) {
    this.cues = cues
    this.looksLikeZoomDialect = looksLikeZoomDialect
    this.hasHeader = hasHeader
  }

  /**
   * Cheap sniff: is this text a WebVTT file at all? The header says so. So
   * does opening on a cue's times: SRT numbers every cue, so a file whose
   * first line is a bare timestamp line can only be a headerless VTT.
   */
  static isVtt(raw: string): boolean {
    const text = opening(raw)
    return text.startsWith('WEBVTT') || TIMESTAMP_RE.test(text)
  }

  static parse(raw: string): ZoomVTT {
    const hasHeader = opening(raw).startsWith('WEBVTT')
    const lines = raw.replace(BOM_RE, '').split(/\r?\n/)
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

    return new ZoomVTT(cues, !hasVoiceTags, hasHeader)
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

  /** The earliest cue start: near zero in a Zoom file, the time of day the transcript began in the headerless dialect; null without cues */
  get startSeconds(): number | null {
    if (this.cues.length === 0) return null
    return this.cues.reduce((min, c) => Math.min(min, c.startSeconds), Infinity)
  }

  /**
   * Meeting length, rounded to whole minutes. A file with a header counts
   * from zero, the recording's start, so the latest cue end is the length.
   * The headerless dialect stamps the time of day, so its length runs from
   * the first cue instead — a call from 9:00 to 9:41 is 41 minutes, not 581.
   */
  get durationMinutes(): number | null {
    if (this.cues.length === 0) return null
    const end = this.cues.reduce((max, c) => Math.max(max, c.endSeconds), 0)
    const start = this.hasHeader ? 0 : (this.startSeconds ?? 0)
    return Math.round((end - start) / 60)
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
