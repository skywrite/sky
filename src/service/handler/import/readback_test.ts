import { assert, test } from '#test'
import {
  AUDIO_LIMIT_BYTES,
  IMAGE_LIMIT_BYTES,
  lengthLabel,
  readAudio,
  readImage,
  readSrt,
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

const SRT = `1
00:00:01,000 --> 00:00:04,000
Jane Doe: Morning, everyone.

2
00:00:04,500 --> 00:00:09,000
Alex Chen: Morning. Shall we start with pricing?

3
00:00:09,500 --> 00:12:20,000
Jane Doe: Yes. The floor moves to the usage tier.
`

test('sourceOf', () => {
  assert({
    given: 'file names of each kind',
    should: 'point at the door family, or nowhere',
    actual: ['call.VTT', 'talk.srt', 'notes.txt', 'memo.m4a', 'song.MP3', 'chat.png', 'photo.HEIC', 'deck.pdf'].map(
      sourceOf,
    ),
    expected: ['transcript', 'srt', 'text', 'audio', 'audio', 'image', 'image', null],
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

test('readSrt', () => {
  const back = readSrt(SRT, 'atlas-walkthrough.srt')
  assert({
    given: "a video's .srt",
    should: 'read its length, turns and speakers, say nothing of the clock, and offer it as a video',
    actual: [back.summary, back.detail, back.durationMinutes, back.clockStartSeconds, back.kinds, back.refusal],
    expected: ['Transcript · 12 minutes · 3 turns', 'Jane Doe, Alex Chen', 12, null, ['video'], null],
  })
  assert({
    given: 'a WebVTT body in an .srt, and an SRT body under the other two extensions',
    should: 'send each to its own door',
    actual: [
      readSrt(VTT, 'talk.srt').refusal,
      readTranscript(SRT, 'talk.vtt').refusal,
      readText(SRT, 'talk.txt').refusal,
    ],
    expected: [
      'talk.srt is a WebVTT transcript — save it as .vtt.',
      'talk.vtt is an SRT transcript — save it as .srt.',
      'talk.txt is an SRT transcript — save it as .srt.',
    ],
  })
  assert({
    given: 'an .srt that is not SubRip',
    should: 'refuse in a sentence',
    actual: readSrt('hello there', 'x.srt').refusal,
    expected: 'x.srt is not an SRT transcript.',
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

test('readImage', () => {
  assert({
    given: 'a screenshot whose header states its pixels',
    should: 'say so and offer it as a message',
    actual: [readImage(254_000, { width: 1170, height: 2532 }).summary, readImage(254_000, null).summary],
    expected: ['Screenshot · 1170 × 2532', 'Screenshot'],
  })
  assert({
    given: 'the kinds a screenshot can be',
    should: 'be a message only',
    actual: [readImage(254_000, null).kinds, readImage(254_000, null).source, readImage(254_000, null).refusal],
    expected: [['message'], 'image', null],
  })
  assert({
    given: "an image over the model's cap",
    should: 'refuse up front',
    actual: readImage(IMAGE_LIMIT_BYTES + 1.5 * 1024 * 1024, { width: 5120, height: 2880 }).refusal,
    expected: 'The screenshot is 9 MB, over the 7.5 MB limit. Crop it, or save it as a JPEG.',
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
    expected:
      "Sky doesn't take .pdf files. Drop a Zoom transcript (.vtt), a video's .srt, a voice memo, a notetaker's .txt, or a screenshot of a conversation.",
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
