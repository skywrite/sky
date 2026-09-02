import { assert, test } from '#test'
import {
  AUDIO_LIMIT_BYTES,
  lengthLabel,
  readAudio,
  readText,
  readTranscript,
  readUnknown,
  sourceOf,
} from './readback.ts'

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Jane Doe: Morning, everyone.

2
00:00:04.500 --> 00:00:09.000
Alex Chen: Morning. Shall we start with pricing?

3
00:00:09.500 --> 00:46:30.000
Jane Doe: Yes. The floor moves to the usage tier.
`

test('sourceOf', () => {
  assert({
    given: 'file names of each kind',
    should: 'point at the door family, or nowhere',
    actual: ['call.VTT', 'notes.txt', 'memo.m4a', 'song.MP3', 'deck.pdf'].map(sourceOf),
    expected: ['transcript', 'text', 'audio', 'audio', null],
  })
})

test('readTranscript', () => {
  const back = readTranscript(VTT, 'atlas-pricing-sync.vtt')
  assert({
    given: 'a Zoom transcript',
    should: 'read its length, turns and speakers, and offer it as a meeting',
    actual: {
      summary: back.summary,
      detail: back.detail,
      minutes: back.durationMinutes,
      clock: back.clockStartSeconds,
      kinds: back.kinds,
      refusal: back.refusal,
    },
    expected: {
      summary: 'Zoom transcript · 47 minutes · 3 turns',
      detail: 'Jane Doe, Alex Chen',
      minutes: 47,
      clock: null,
      kinds: ['meeting'],
      refusal: null,
    },
  })
  assert({
    given: 'a .vtt that is not WebVTT',
    should: 'refuse in a sentence',
    actual: readTranscript('hello there', 'x.vtt').refusal,
    expected: 'x.vtt is not a WebVTT transcript.',
  })
})

test('readText', () => {
  assert({
    given: 'RTF renamed to .txt',
    should: 'refuse it, as the CLI does',
    actual: readText('{\\rtf1\\ansi hello}', 'notes.txt').refusal,
    expected: 'notes.txt is RTF, not plain text. Convert it to .txt first.',
  })
  assert({
    given: 'a WebVTT body in a .txt',
    should: 'send it to the transcript door',
    actual: readText(VTT, 'notes.txt').refusal,
    expected: 'notes.txt is a WebVTT transcript — save it as .vtt.',
  })
  const back = readText('[0:00] Jane: Morning.\n[0:12] Alex: Morning.\n[11:40] Jane: Done.', 'notes.txt')
  assert({
    given: 'stamped speaker lines',
    should: 'read the stamps for the length and offer a meeting',
    actual: [back.summary, back.kinds, back.refusal],
    expected: ['Notetaker text · 12 minutes · 3 stamped turns', ['meeting'], null],
  })
})

test('readAudio', () => {
  assert({
    given: 'a recording with a known length',
    should: 'say what it is and offer every kind',
    actual: [readAudio(3_900_000, 252).summary, readAudio(3_900_000, 252).kinds.length],
    expected: ['Voice memo · 4 min 12 s', 5],
  })
  assert({
    given: 'a recording over the request cap',
    should: 'refuse up front',
    actual: readAudio(AUDIO_LIMIT_BYTES + 6 * 1024 * 1024, 3600).refusal,
    expected: 'The recording is 31 MB, over the 25 MB limit. Trim it, or record shorter parts.',
  })
  assert({
    given: 'a length the container could not give',
    should: 'still read as a voice memo',
    actual: readAudio(1000, null).summary,
    expected: 'Voice memo',
  })
})

test('lengthLabel and readUnknown', () => {
  assert({
    given: 'lengths in seconds',
    should: 'read as people say them',
    actual: [lengthLabel(30), lengthLabel(252), lengthLabel(2790), lengthLabel(60), lengthLabel(null)],
    expected: ['under a minute', '4 min 12 s', '46 minutes', '1 minute', null],
  })
  assert({
    given: 'a file of a kind sky does not take',
    should: 'say so and name what it does take',
    actual: readUnknown('deck.pdf').refusal,
    expected: "Sky doesn't take .pdf files. Drop a Zoom transcript (.vtt), a voice memo, or a notetaker's .txt.",
  })
})

const HEADERLESS = `09:00:00 --> 09:00:02
Jane Doe: Morning.

09:00:02 --> 09:00:05
Alex Chen: Morning. Shall we start?

09:41:10 --> 09:41:12
Jane Doe: Thanks, everyone.
`

test('readTranscript, a transcript without a header', () => {
  const back = readTranscript(HEADERLESS, 'atlas-sync.vtt')
  assert({
    given: "a captioner's .vtt with no WEBVTT line and clock times",
    should: 'read it as a transcript, its length and its start from the first cue, and not call it Zoom',
    actual: [back.summary, back.detail, back.durationMinutes, back.clockStartSeconds, back.kinds, back.refusal],
    expected: ['Transcript · 41 minutes · 3 turns', 'Jane Doe, Alex Chen', 41, 32400, ['meeting'], null],
  })
  assert({
    given: 'the same body in a .txt',
    should: 'send it to the transcript door, as a headered one is',
    actual: readText(HEADERLESS, 'notes.txt').refusal,
    expected: 'notes.txt is a WebVTT transcript — save it as .vtt.',
  })
})
