import { assert, test } from '#test'
import ZoomVTT from './mod.ts'

const FIXTURE = `WEBVTT

1
00:00:03.600 --> 00:00:06.240
Jane Doe: Hey everyone, thanks for joining.

2
00:00:06.240 --> 00:00:09.120
Jane Doe: Let's get started.

3
00:00:09.120 --> 00:00:12.000
John Smith: Sounds good to me.

4
00:00:12.000 --> 00:00:14.500
and the budget question too.

5
00:00:14.500 --> 00:01:30.250
Jane Doe: Great point.
`

test('ZoomVTT.isVtt()', () => {
  assert({
    given: 'a Zoom VTT transcript',
    should: 'detect the WEBVTT header',
    actual: ZoomVTT.isVtt(FIXTURE),
    expected: true,
  })

  assert({
    given: 'a BOM and CRLF line endings',
    should: 'still detect the header',
    actual: ZoomVTT.isVtt('﻿WEBVTT\r\n\r\n1\r\n'),
    expected: true,
  })

  assert({
    given: 'plain markdown text',
    should: 'not detect a VTT',
    actual: ZoomVTT.isVtt('# Meeting notes\nJane said hello.'),
    expected: false,
  })
})

test('ZoomVTT.parse()', () => {
  const vtt = ZoomVTT.parse(FIXTURE)

  assert({
    given: 'a five-cue Zoom VTT',
    should: 'parse every cue',
    actual: vtt.cues.length,
    expected: 5,
  })

  assert({
    given: 'the first cue',
    should: 'extract index, times, speaker, and text',
    actual: vtt.cues[0],
    expected: {
      index: 1,
      startSeconds: 3.6,
      endSeconds: 6.24,
      speaker: 'Jane Doe',
      text: 'Hey everyone, thanks for joining.',
    },
  })

  assert({
    given: 'a cue without a speaker prefix',
    should: 'leave speaker null',
    actual: vtt.cues[3].speaker,
    expected: null,
  })

  assert({
    given: 'clean Zoom cues',
    should: 'report the Zoom dialect',
    actual: vtt.looksLikeZoomDialect,
    expected: true,
  })
})

test('ZoomVTT turns, speakers, duration', () => {
  const vtt = ZoomVTT.parse(FIXTURE)

  assert({
    given: 'consecutive same-speaker cues and an unnamed continuation',
    should: 'merge five cues into three turns',
    actual: vtt.turns.map((t) => t.speaker),
    expected: ['Jane Doe', 'John Smith', 'Jane Doe'],
  })

  assert({
    given: 'an unnamed continuation cue',
    should: 'append its text to the running turn',
    actual: vtt.turns[1].text,
    expected: 'Sounds good to me. and the budget question too.',
  })

  assert({
    given: 'merged turns',
    should: 'extend the turn end time to the last merged cue',
    actual: vtt.turns[0].endSeconds,
    expected: 9.12,
  })

  assert({
    given: 'two speakers across five cues',
    should: 'list unique speakers in order of first appearance',
    actual: vtt.speakers,
    expected: ['Jane Doe', 'John Smith'],
  })

  assert({
    given: 'a final cue ending at 01:30.250',
    should: 'round duration to whole minutes',
    actual: vtt.durationMinutes,
    expected: 2,
  })

  assert({
    given: 'a VTT with no cues',
    should: 'report null duration',
    actual: ZoomVTT.parse('WEBVTT\n').durationMinutes,
    expected: null,
  })
})

test('ZoomVTT.toTurnText()', () => {
  const vtt = ZoomVTT.parse(FIXTURE)

  assert({
    given: 'default options',
    should: 'emit one timestamped paragraph per turn',
    actual: vtt.toTurnText(),
    expected: [
      "[00:00:03] Jane Doe: Hey everyone, thanks for joining. Let's get started.",
      '[00:00:09] John Smith: Sounds good to me. and the budget question too.',
      '[00:00:14] Jane Doe: Great point.',
    ].join('\n\n'),
  })

  assert({
    given: 'timestamps disabled',
    should: 'emit bare speaker paragraphs',
    actual: ZoomVTT.parse(FIXTURE).toTurnText({ timestamps: false }).split('\n\n')[2],
    expected: 'Jane Doe: Great point.',
  })
})

test('ZoomVTT leniency and dialect detection', () => {
  const teamsish = `WEBVTT

00:00:01.000 --> 00:00:02.000
<v John Smith>Hello there</v>
`
  const vtt = ZoomVTT.parse(teamsish)

  assert({
    given: 'Teams-style voice tags',
    should: 'flag the transcript as not Zoom dialect',
    actual: vtt.looksLikeZoomDialect,
    expected: false,
  })

  assert({
    given: 'Teams-style voice tags',
    should: 'still strip markup from the cue text',
    actual: vtt.cues[0].text,
    expected: 'Hello there',
  })

  const messy = `WEBVTT

garbage block that is not a cue

1
not-a-timestamp --> also-not
Jane Doe: lost cue

2
00:00:05.000 --> 00:00:06.000 align:start position:0%
Jane Doe: survives
with a second payload line
`
  const parsed = ZoomVTT.parse(messy)

  assert({
    given: 'garbage blocks, a malformed timestamp, and cue settings',
    should: 'keep only the well-formed cue',
    actual: parsed.cues.length,
    expected: 1,
  })

  assert({
    given: 'a multi-line payload',
    should: 'join payload lines with a space',
    actual: parsed.cues[0].text,
    expected: 'survives with a second payload line',
  })
})

const HEADERLESS = `09:00:00 --> 09:00:02
Jane Doe: Morning.

09:00:02 --> 09:00:05
Alex Chen: Morning. Shall we start?

09:00:04 --> 09:00:06
Jane Doe: Yes.

09:41:10 --> 09:41:12
Alex Chen: Thanks, everyone.
`

test('ZoomVTT headerless dialect', () => {
  assert({
    given: "a captioner's file with no WEBVTT line, no cue numbers and whole-second times",
    should: 'sniff as a VTT, since only a VTT opens on a bare timestamp line',
    actual: ZoomVTT.isVtt(HEADERLESS),
    expected: true,
  })

  assert({
    given: 'a headerless file whose cues are numbered',
    should: 'leave it to the SRT reader',
    actual: ZoomVTT.isVtt('1\n00:00:01,000 --> 00:00:02,000\nHello\n'),
    expected: false,
  })

  const vtt = ZoomVTT.parse(HEADERLESS)

  assert({
    given: 'whole-second cue times',
    should: 'parse every cue',
    actual: vtt.cues.length,
    expected: 4,
  })

  assert({
    given: 'a file with no header',
    should: 'say so',
    actual: [vtt.hasHeader, ZoomVTT.parse(FIXTURE).hasHeader],
    expected: [false, true],
  })

  assert({
    given: 'the first cue',
    should: 'read the clock time as seconds and the speaker',
    actual: [vtt.cues[0].startSeconds, vtt.cues[0].speaker, vtt.cues[0].index],
    expected: [32400, 'Jane Doe', null],
  })

  assert({
    given: 'times of day from 09:00:00 to 09:41:12',
    should: 'measure the length from the first cue, not from midnight',
    actual: vtt.durationMinutes,
    expected: 41,
  })

  assert({
    given: 'clock times',
    should: 'stamp the turns with the clock',
    actual: vtt.toTurnText().split('\n\n')[0],
    expected: '[09:00:00] Jane Doe: Morning.',
  })

  assert({
    given: 'a headered file with a whole-second cue',
    should: 'parse the cue and still count the length from zero',
    actual: ZoomVTT.parse('WEBVTT\n\n00:03:30 --> 00:03:32\nJane Doe: Hi\n').durationMinutes,
    expected: 4,
  })
})

test('ZoomVTT.startSeconds', () => {
  assert({
    given: 'a headerless file whose first cue is at 09:00:00, and a file with no cues',
    should: 'report the earliest cue start in seconds, and null without cues',
    actual: [ZoomVTT.parse(HEADERLESS).startSeconds, ZoomVTT.parse('WEBVTT\n').startSeconds],
    expected: [32400, null],
  })
})
