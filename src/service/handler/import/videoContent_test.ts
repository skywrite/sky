import { spyOn } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import * as config from '#config'
import { runFfmpeg } from '#lib/media/ffmpeg/mod.ts'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import * as settings from '#shared/config/loader.ts'
import { assert, test } from '#test'
import { createImportHost } from './createImportHost.ts'

const available = (await isCommandAvailable('ffmpeg')) && (await isCommandAvailable('ffprobe'))

test(
  'video import probes the tracks and applies transcription limits to audio only',
  { ignore: !available },
  async () => {
    const base = await mkdtemp('/tmp/sky-video-import-')
    const video = path.join(base, 'journal.mp4')
    const silent = path.join(base, 'silent.mp4')
    const audio = path.join(base, 'audio.mp4')
    const defaults = settings.loadSkyConfig(path.join(base, 'missing-config.jsonc'))
    const load = spyOn(settings, 'loadSkyConfig').mockReturnValue(defaults)
    try {
      await runFfmpeg('ffmpeg', [
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=16x16:d=1',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=16000:cl=mono',
        '-shortest',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        video,
      ])
      await runFfmpeg('ffmpeg', ['-i', video, '-an', '-c:v', 'copy', silent])
      await runFfmpeg('ffmpeg', ['-i', video, '-vn', '-c:a', 'copy', audio])
      const before = await readFile(video)
      const host = createImportHost(config, {})
      const big = 1024 * 1024 * 1024
      const recording = await host.read({ path: video, name: 'journal.mov', size: big })
      const muted = await host.read({ path: silent, name: 'silent.mp4', size: big })
      const audioOnly = await host.read({ path: audio, name: 'audio.mp4', size: big })
      assert({
        given: 'a large video, a muted video, and audio stored in an MP4 container',
        should: 'route video journals, refuse absent speech tracks, enforce the audio cap, and preserve the video',
        actual: [
          recording.source,
          recording.kinds,
          recording.refusal,
          muted.kinds,
          muted.refusal,
          audioOnly.source,
          Boolean(audioOnly.refusal),
          (await readFile(video)).equals(before),
          await host.calendar?.('2031-03-16 08:00', recording),
        ],
        expected: ['video', ['journal'], null, [], 'This file has no audio track.', 'audio', true, true, null],
      })
    } finally {
      load.mockRestore()
      await rm(base, { recursive: true, force: true })
    }
  },
)
