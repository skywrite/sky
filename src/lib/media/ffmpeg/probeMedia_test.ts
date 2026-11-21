import { assert, test } from '#test'
import { mediaInfoFrom } from './probeMedia.ts'

/** ffprobe's report for a phone video, copied off the phone a few days after it was made. */
const COPIED = JSON.stringify({
  streams: [{ codec_type: 'video' }, { codec_type: 'audio' }, { codec_type: 'data' }],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '312.480000',
    tags: {
      creation_time: '2031-03-16T14:00:08.000000Z',
      'com.apple.quicktime.creationdate': '2031-03-12T07:45:10-0400',
    },
  },
})

test('a phone video keeps when it began recording after a copy resets its other clock', () => {
  assert({
    given: 'a copied phone video carrying its capture date with a compact offset',
    should: 'report the capture date in RFC 3339 beside the reset creation time',
    actual: mediaInfoFrom(COPIED, 'journal.mov'),
    expected: {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 312.48,
      hasAudio: true,
      hasVideo: true,
      creationTime: '2031-03-16T14:00:08.000000Z',
      capturedAt: '2031-03-12T07:45:10-04:00',
    },
  })
  const capturedAt = (tag: string) =>
    mediaInfoFrom(JSON.stringify({ format: { tags: { 'com.apple.quicktime.creationdate': tag } } }), 'clip.mov')
      .capturedAt
  assert({
    given: 'capture dates in UTC, with a colon offset, without an offset, and not a date',
    should: 'keep the ones that name a moment and drop the rest',
    actual: [
      capturedAt('2031-03-12T11:45:10Z'),
      capturedAt('2031-03-12T07:45:10+05:30'),
      capturedAt('2031-03-12T07:45:10'),
      capturedAt('yesterday'),
    ],
    expected: ['2031-03-12T11:45:10Z', '2031-03-12T07:45:10+05:30', null, null],
  })
  assert({
    given: 'a recording with no tags',
    should: 'report no clock of its own',
    actual: [mediaInfoFrom('{"format":{}}', 'memo.m4a').creationTime, mediaInfoFrom('{}', 'memo.m4a').capturedAt],
    expected: [null, null],
  })
})

test('an audio recording with cover art still imports as audio', () => {
  const streams = [{ codec_type: 'audio' }, { codec_type: 'video', disposition: { attached_pic: 1 } }]
  assert({
    given: 'a voice recording whose only visual stream is its cover image',
    should: 'keep the audio import choices',
    actual: mediaInfoFrom(JSON.stringify({ streams }), 'memo.m4a').hasVideo,
    expected: false,
  })
})
