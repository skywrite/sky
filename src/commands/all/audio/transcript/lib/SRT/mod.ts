/**
 * Parser for SubRip (.srt) transcripts — the second transcript dialect this
 * notebook ingests, alongside `../ZoomVTT/mod.ts`. Same surface as that class so
 * both drop into the same hook in `audio:transcript:clean`.
 *
 * Two things differ from the VTT parser, both forced by the format:
 *
 * 1. **No magic header.** WebVTT announces itself with `WEBVTT`; SRT has nothing,
 *    so `isSrt` sniffs structure — a numeric cue id followed by a `-->` timestamp
 *    line. Spec says the decimal separator is a comma; parsing accepts a period
 *    too, since exporters disagree.
 *
 * 2. **Turn merging is gap-driven, not speaker-driven.** SRT usually carries no
 *    speaker labels at all. ZoomVTT treats an unlabelled cue as a continuation of
 *    the running turn, which for a speaker-less file collapses every cue into one
 *    unreadable block. Here a turn also breaks on a silence gap or a length cap, so
 *    a monologue still paragraphs at its natural pauses.
 *
 * Parsing is lenient: unrecognized blocks and malformed cues are skipped, never
 * thrown on — a bad cue must not sink the transcript pipeline.
 */

export interface SRTCue {
  /** Numeric cue identifier when present (SRT numbers every cue) */
  index: number | null
  startSeconds: number
  endSeconds: number
  /** Speaker from a `Name: text` payload prefix, null when absent — see `detectSpeakerLabels` */
  speaker: string | null
  text: string
}

export interface SRTTurn {
  speaker: string | null
  startSeconds: number
  endSeconds: number
  text: string
}

export interface SRTTurnOptions {
  /**
   * Silence between cues that starts a new turn. 1.5s sits above the sub-second
   * gaps of continuous speech and below a deliberate pause at a topic change.
   */
  gapSeconds?: number
  /**
   * Safety valve for pathological input, not a paragraph formatter: a recording
   * with no pause at all would otherwise become one unbounded turn. Set high
   * enough that ordinary speech never reaches it, because the break lands on a
   * cue boundary — which SRT exporters happily place mid-sentence.
   */
  maxChars?: number
}

const TIMESTAMP_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/
const SPEAKER_RE = /^([^:]{1,64}?):\s+(.*)$/s
/**
 * A speaker label is name-shaped: 1-4 words of letters (plus . ' -), no digits and
 * no sentence punctuation. Keeps `Revenue:` or `Q4:` from being read as speakers.
 */
const SPEAKER_NAME_RE = /^[\p{Lu}][\p{L}.'-]*(?: [\p{L}][\p{L}.'-]*){0,3}$/u
/** A candidate must prefix at least this many cues to count as a speaker, not a stray colon. */
const SPEAKER_MIN_CUES = 2

const DEFAULT_GAP_SECONDS = 1.5
/** ~500 words, i.e. minutes of unbroken speech — reached only by degenerate input */
const DEFAULT_MAX_CHARS = 3000

/**
 * Accumulate in integer milliseconds, then divide once. Summing float seconds
 * (`3 + 0.494`) lands a bit off the double you get from writing `3.494`, which is
 * invisible downstream but makes exact-value assertions unpleasant.
 */
function timeToSeconds(t: string): number {
  const [main, frac = '0'] = t.replace(',', '.').split('.')
  const parts = main.split(':').map(Number)
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]]
  const ms = Number(frac.padEnd(3, '0').slice(0, 3))
  return (h * 3600000 + m * 60000 + s * 1000 + ms) / 1000
}

function secondsToHMS(total: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Which `Name:` prefixes across the file are real speaker labels.
 *
 * The decision is made per file, not per prefix. One name-shaped prefix repeated
 * across SPEAKER_MIN_CUES cues establishes that this transcript labels its speakers
 * at all; once established, every name-shaped prefix is trusted — including one that
 * appears once, since a participant who speaks a single line is ordinary in a
 * dialogue. Judging each prefix on its own count would drop exactly those people.
 *
 * With nothing repeated, no prefix is a speaker: a monologue containing `Note: ...`
 * keeps that text intact. False positives are the expensive direction, because they
 * silently eat the opening words of a cue.
 */
function detectSpeakerLabels(rawTexts: readonly string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const text of rawTexts) {
    const m = text.match(SPEAKER_RE)
    if (!m) continue
    const candidate = m[1].trim()
    if (!SPEAKER_NAME_RE.test(candidate)) continue
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1)
  }

  const isLabelledTranscript = [...counts.values()].some((n) => n >= SPEAKER_MIN_CUES)
  return isLabelledTranscript ? new Set(counts.keys()) : new Set()
}

export default class SRT {
  readonly cues: SRTCue[]

  private constructor(cues: SRTCue[]) {
    this.cues = cues
  }

  /**
   * Cheap sniff: does this text look like SubRip? SRT has no header, so this looks
   * for its block structure — a numeric cue id above a `-->` timestamp line. An
   * explicit WEBVTT header disqualifies it, so a numbered Zoom VTT never matches.
   */
  static isSrt(raw: string): boolean {
    const text = raw.replace(/^﻿/, '').trimStart()
    if (text.startsWith('WEBVTT')) return false

    const lines = text.split(/\r?\n/)
    const limit = Math.min(lines.length - 1, 40)
    for (let i = 0; i < limit; i++) {
      if (/^\d+$/.test(lines[i].trim()) && TIMESTAMP_RE.test(lines[i + 1].trim())) return true
    }
    return false
  }

  static parse(raw: string): SRT {
    const lines = raw.replace(/^﻿/, '').split(/\r?\n/)

    // Collected first so speaker detection can look at the whole file before
    // deciding whether any `Name:` prefix is really a speaker.
    const partial: Array<Omit<SRTCue, 'speaker'>> = []

    let i = 0
    while (i < lines.length) {
      const line = lines[i].trim()

      if (line === '') {
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
      // Ignore anything trailing the end time (SRT position coords: "X1:0 X2:100 ...")
      const endSeconds = timeToSeconds(endRaw.trim().split(/\s+/)[0])
      i++

      const payload: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        payload.push(lines[i].trim())
        i++
      }

      // Strip styling markup (<i>, <b>, <font color=...>) and the leading hyphen
      // some exporters use to mark a speaker change.
      const text = payload
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/^-\s+/, '')
        .trim()

      if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
        partial.push({ index, startSeconds, endSeconds, text })
      }
    }

    const speakerLabels = detectSpeakerLabels(partial.map((c) => c.text))

    const cues: SRTCue[] = partial.map((cue) => {
      const m = cue.text.match(SPEAKER_RE)
      if (m && speakerLabels.has(m[1].trim())) {
        return { ...cue, speaker: m[1].trim(), text: m[2] }
      }
      return { ...cue, speaker: null }
    })

    return new SRT(cues)
  }

  /** Unique speakers in order of first appearance; empty for an unlabelled transcript */
  get speakers(): string[] {
    const seen = new Set<string>()
    for (const cue of this.cues) {
      if (cue.speaker) seen.add(cue.speaker)
    }
    return [...seen]
  }

  /**
   * Cues merged into readable turns. A turn continues while the speaker is
   * unchanged (an unlabelled cue continues the running turn), the silence before
   * the next cue stays under `gapSeconds`, and the text stays under `maxChars`.
   *
   * The gap and length rules are what make this usable on speaker-less transcripts,
   * where merging on speaker alone would yield exactly one turn.
   */
  turns(options: SRTTurnOptions = {}): SRTTurn[] {
    const { gapSeconds = DEFAULT_GAP_SECONDS, maxChars = DEFAULT_MAX_CHARS } = options
    const turns: SRTTurn[] = []

    for (const cue of this.cues) {
      const last = turns[turns.length - 1]
      const sameSpeaker = last && (cue.speaker === last.speaker || cue.speaker === null)
      const withinGap = last && cue.startSeconds - last.endSeconds <= gapSeconds
      const withinLength = last && last.text.length + cue.text.length + 1 <= maxChars

      if (sameSpeaker && withinGap && withinLength) {
        if (cue.text) last.text = last.text ? `${last.text} ${cue.text}` : cue.text
        last.endSeconds = cue.endSeconds
      } else {
        turns.push({
          speaker: cue.speaker ?? (sameSpeaker ? last.speaker : null),
          startSeconds: cue.startSeconds,
          endSeconds: cue.endSeconds,
          text: cue.text,
        })
      }
    }

    return turns
  }

  /** Recording length from the latest cue end time, rounded to whole minutes */
  get durationMinutes(): number | null {
    if (this.cues.length === 0) return null
    const end = this.cues.reduce((max, c) => Math.max(max, c.endSeconds), 0)
    return Math.round(end / 60)
  }

  /**
   * Compact model-facing text: one paragraph per turn, optionally anchored with the
   * turn's start time. This is what strips the cue-number/timestamp overhead — well
   * over half the bytes of a typical SRT — before the transcript reaches an AI call.
   */
  toTurnText(options: SRTTurnOptions & { timestamps?: boolean } = {}): string {
    const { timestamps = true, ...turnOptions } = options
    return this.turns(turnOptions)
      .map((t) => {
        const stamp = timestamps ? `[${secondsToHMS(t.startSeconds)}] ` : ''
        const name = t.speaker ? `${t.speaker}: ` : ''
        return `${stamp}${name}${t.text}`
      })
      .join('\n\n')
  }
}
