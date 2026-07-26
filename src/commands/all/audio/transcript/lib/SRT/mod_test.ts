import { assert, test } from '#test'
import SRT from './mod.ts'

/** Monologue: no speaker labels, sub-second gaps, one deliberate 2.6s pause before cue 4 */
const MONOLOGUE = `1
00:00:00,000 --> 00:00:03,494
Hi everyone, Jane here with the weekly update for the third week of

2
00:00:03,495 --> 00:00:06,213
July. So, group snapshot,

3
00:00:06,214 --> 00:00:08,561
signups are up 30% week on week,

4
00:00:11,200 --> 00:00:14,000
So, turning to Atlas,

5
00:00:14,001 --> 00:00:16,500
revenue is flat.
`

/** Dialogue: repeated `Name:` prefixes, which should be read as speakers */
const DIALOGUE = `1
00:00:01,000 --> 00:00:03,000
Jane Doe: Thanks for joining.

2
00:00:03,100 --> 00:00:05,000
Jane Doe: Let's start with revenue.

3
00:00:05,100 --> 00:00:07,000
John Smith: Sounds good.

4
00:00:07,100 --> 00:00:09,000
and the budget too.
`

test('SRT.isSrt()', () => {
  assert({
    given: 'a SubRip transcript',
    should: 'detect the numeric-id + timestamp structure',
    actual: SRT.isSrt(MONOLOGUE),
    expected: true,
  })

  assert({
    given: 'a BOM and CRLF line endings',
    should: 'still detect it',
    actual: SRT.isSrt('﻿1\r\n00:00:00,000 --> 00:00:01,000\r\nHello\r\n'),
    expected: true,
  })

  assert({
    given: 'a WebVTT transcript with numbered cues',
    should: 'not claim it — the WEBVTT header disqualifies it',
    actual: SRT.isSrt('WEBVTT\n\n1\n00:00:03.600 --> 00:00:06.240\nJane Doe: Hi\n'),
    expected: false,
  })

  assert({
    given: 'plain markdown text',
    should: 'not detect an SRT',
    actual: SRT.isSrt('# Notes\nJane said hello.'),
    expected: false,
  })
})

test('SRT.parse()', () => {
  const srt = SRT.parse(MONOLOGUE)

  assert({
    given: 'a five-cue SRT',
    should: 'parse every cue',
    actual: srt.cues.length,
    expected: 5,
  })

  assert({
    given: 'the first cue',
    should: 'extract index, comma-decimal times, and text',
    actual: srt.cues[0],
    expected: {
      index: 1,
      startSeconds: 0,
      endSeconds: 3.494,
      speaker: null,
      text: 'Hi everyone, Jane here with the weekly update for the third week of',
    },
  })

  assert({
    given: 'an unlabelled monologue',
    should: 'report no speakers',
    actual: srt.speakers,
    expected: [],
  })

  assert({
    given: 'a final cue ending at 00:16.500',
    should: 'round duration to whole minutes',
    actual: srt.durationMinutes,
    expected: 0,
  })

  assert({
    given: 'an SRT with no cues',
    should: 'report null duration',
    actual: SRT.parse('').durationMinutes,
    expected: null,
  })
})

test('SRT turns break on silence, not just speaker', () => {
  const srt = SRT.parse(MONOLOGUE)
  const turns = srt.turns()

  assert({
    given: 'an unlabelled monologue with one 2.6s pause',
    should: 'split into two turns at the pause, not collapse into one',
    actual: turns.length,
    expected: 2,
  })

  assert({
    given: 'cues before the pause',
    should: 'merge them into the first turn',
    actual: turns[0].text,
    expected:
      'Hi everyone, Jane here with the weekly update for the third week of July. So, group snapshot, signups are up 30% week on week,',
  })

  assert({
    given: 'a merged turn',
    should: 'extend its end time to the last merged cue',
    actual: turns[0].endSeconds,
    expected: 8.561,
  })

  assert({
    given: 'a gap threshold above the pause',
    should: 'merge everything into one turn',
    actual: srt.turns({ gapSeconds: 5 }).length,
    expected: 1,
  })

  assert({
    given: 'a gap threshold below normal speech gaps',
    should: 'give one turn per cue',
    actual: srt.turns({ gapSeconds: 0 }).length,
    expected: 5,
  })
})

test('SRT turns respect the maxChars safety valve', () => {
  const srt = SRT.parse(MONOLOGUE)

  assert({
    given: 'a low char cap on gapless cues',
    should: 'break the turn even with no silence',
    actual: srt.turns({ gapSeconds: 999, maxChars: 80 }).length > 1,
    expected: true,
  })

  assert({
    given: 'the default cap',
    should: 'not fire on ordinary speech',
    actual: srt.turns({ gapSeconds: 999 }).length,
    expected: 1,
  })
})

test('SRT speaker detection requires a repeated, name-shaped prefix', () => {
  const srt = SRT.parse(DIALOGUE)

  assert({
    given: 'prefixes repeated across cues',
    should: 'read them as speakers in order of appearance',
    actual: srt.speakers,
    expected: ['Jane Doe', 'John Smith'],
  })

  assert({
    given: 'a labelled cue',
    should: 'strip the label from the text',
    actual: srt.cues[0].text,
    expected: 'Thanks for joining.',
  })

  assert({
    given: 'consecutive same-speaker cues and an unlabelled continuation',
    should: 'merge four cues into two turns',
    actual: srt.turns().map((t) => t.speaker),
    expected: ['Jane Doe', 'John Smith'],
  })

  assert({
    given: 'an unlabelled continuation cue',
    should: 'append its text to the running turn',
    actual: srt.turns()[1].text,
    expected: 'Sounds good. and the budget too.',
  })

  const strayColon = `1
00:00:01,000 --> 00:00:02,000
Revenue: down 20% this quarter.

2
00:00:02,100 --> 00:00:03,000
Costs held flat.
`

  assert({
    given: 'a colon prefix appearing only once',
    should: 'not treat it as a speaker',
    actual: SRT.parse(strayColon).speakers,
    expected: [],
  })

  assert({
    given: 'a colon prefix appearing only once',
    should: 'keep the prefix in the text rather than eating it',
    actual: SRT.parse(strayColon).cues[0].text,
    expected: 'Revenue: down 20% this quarter.',
  })
})

test('SRT.toTurnText()', () => {
  assert({
    given: 'default options on a monologue',
    should: 'emit one timestamped paragraph per turn with no speaker prefix',
    actual: SRT.parse(MONOLOGUE).toTurnText(),
    expected: [
      '[00:00:00] Hi everyone, Jane here with the weekly update for the third week of July. So, group snapshot, signups are up 30% week on week,',
      '[00:00:11] So, turning to Atlas, revenue is flat.',
    ].join('\n\n'),
  })

  assert({
    given: 'timestamps disabled on a dialogue',
    should: 'emit bare speaker paragraphs',
    actual: SRT.parse(DIALOGUE).toTurnText({ timestamps: false }),
    expected: [
      "Jane Doe: Thanks for joining. Let's start with revenue.",
      'John Smith: Sounds good. and the budget too.',
    ].join('\n\n'),
  })
})

test('SRT leniency', () => {
  const messy = `garbage block that is not a cue

1
not-a-timestamp --> also-not
lost cue

2
00:00:05,000 --> 00:00:06,000 X1:0 X2:100 Y1:0 Y2:20
<i>survives</i> with <font color="#fff">markup</font>
and a second payload line

3
00:00:20,000 --> 00:00:21,000
- dash-prefixed speaker change
`
  const srt = SRT.parse(messy)

  assert({
    given: 'garbage blocks and a malformed timestamp',
    should: 'keep only the well-formed cues',
    actual: srt.cues.length,
    expected: 2,
  })

  assert({
    given: 'position coordinates after the end time',
    should: 'ignore them and still parse the end time',
    actual: srt.cues[0].endSeconds,
    expected: 6,
  })

  assert({
    given: 'styling markup and a multi-line payload',
    should: 'strip tags and join payload lines with a space',
    actual: srt.cues[0].text,
    expected: 'survives with markup and a second payload line',
  })

  assert({
    given: 'a dash-prefixed speaker-change cue',
    should: 'strip the leading dash',
    actual: srt.cues[1].text,
    expected: 'dash-prefixed speaker change',
  })

  assert({
    given: 'period decimal separators instead of commas',
    should: 'still parse — exporters disagree on the separator',
    actual: SRT.parse('1\n00:00:01.500 --> 00:00:02.500\nHello\n').cues[0].startSeconds,
    expected: 1.5,
  })
})
