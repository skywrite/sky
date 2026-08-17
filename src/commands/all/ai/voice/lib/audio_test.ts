import { assert, test } from '#test'
import { pcmMs, playbackPosition, scanPeak } from './audio.ts'

test('pcmMs converts PCM16 mono 24kHz byte counts to milliseconds', () => {
  assert({
    given: 'one second of audio (48000 bytes)',
    should: 'be 1000ms',
    expected: 1000,
    actual: pcmMs(48_000),
  })

  assert({
    given: 'no bytes',
    should: 'be 0ms',
    expected: 0,
    actual: pcmMs(0),
  })
})

test('scanPeak finds the loudest strided int16 sample in little-endian PCM', () => {
  // 16 samples; the scan strides every 4th (indices 0, 4, 8, 12).
  const chunk = new Uint8Array(32)
  const view = new DataView(chunk.buffer)
  view.setInt16(0, 300, true) // sample 0 — scanned
  view.setInt16(8, -2000, true) // sample 4 — scanned, loudest, negative
  view.setInt16(24, 900, true) // sample 12 — scanned

  assert({
    given: 'a chunk whose loudest scanned sample is -2000',
    should: 'report its magnitude',
    expected: 2000,
    actual: scanPeak(chunk, 0),
  })

  assert({
    given: 'a running peak above everything in the chunk',
    should: 'keep the running peak',
    expected: 5000,
    actual: scanPeak(chunk, 5000),
  })

  assert({
    given: 'a silent chunk',
    should: 'leave the running peak unchanged',
    expected: 42,
    actual: scanPeak(new Uint8Array(64), 42),
  })
})

test('playbackPosition clamps to what was actually sent', () => {
  assert({
    given: 'a 1s utterance interrupted at 500ms',
    should: 'report 500ms played, still playing',
    expected: { playedMs: 500, stillPlaying: true },
    actual: playbackPosition(48_000, 500),
  })

  assert({
    given: 'a 1s utterance that finished draining long ago',
    should: 'clamp position to the full second, no longer playing',
    expected: { playedMs: 1000, stillPlaying: false },
    actual: playbackPosition(48_000, 1500),
  })

  assert({
    given: 'elapsed exactly at the sent duration',
    should: 'count as finished — nothing left to truncate',
    expected: { playedMs: 1000, stillPlaying: false },
    actual: playbackPosition(48_000, 1000),
  })

  assert({
    given: 'nothing sent yet',
    should: 'report zero and not playing',
    expected: { playedMs: 0, stillPlaying: false },
    actual: playbackPosition(0, 100),
  })
})
