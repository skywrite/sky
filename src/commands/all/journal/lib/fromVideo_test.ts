import { spyOn } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import * as media from '#lib/media/ffmpeg/mod.ts'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { journalFromVideo } from './fromVideo.ts'
import * as journal from './recordedJournal.ts'

test('video journals share the corrected-text pipeline, retain the video source, and remove extracted scratch audio', async () => {
  for (const [succeeds, stated] of [
    [true, false],
    [true, true],
    [false, false],
  ]) {
    const base = await makeTempDir({ prefix: 'sky-video-journal-' })
    const source = path.join(base, 'recording.mp4')
    const audio = path.join(base, 'extracted', 'audio.m4a')
    await mkdir(path.dirname(audio))
    await writeFile(source, 'synthetic video')
    await writeFile(audio, 'synthetic extracted audio')
    const when = new PlainDateTime('2031-03-16 08:00')
    const now = new ZonedDateTime(when, 'UTC')
    const context = CommandContext.test(config, { notebookNow: now, systemNow: now })
    const tasks = new CommandService(context)
    const run = await TranscriptRun.forFile(source, { dir: path.join(base, 'runs'), now: () => when.toString() })
    const probe = spyOn(media, 'probeMedia').mockResolvedValue({
      formatName: 'mp4',
      durationSeconds: 120,
      creationTime: '2031-03-16T09:02:00Z',
      hasAudio: true,
      hasVideo: true,
    })
    const extract = spyOn(media, 'extractAudio').mockResolvedValue(audio)
    const open = spyOn(TranscriptRun, 'forFile').mockResolvedValue(run)
    const clean = spyOn(tasks, 'run').mockImplementation(async (name, args) => {
      assert({
        given: 'a recorded video',
        should: 'clean extracted audio using the video’s checkpoint identity',
        actual: [name, args],
        expected: ['audio:transcript:clean', { fromAudio: audio, run: run.key }],
      })
      return succeeds
        ? CommandResult.success({ cleanedText: 'Jane Doe helped with Atlas.', who: [], rel: ['Jane Doe'] })
        : CommandResult.fail('Synthetic transcription failure')
    })
    const file = spyOn(journal, 'fileRecordedJournal').mockImplementation(async (options) => {
      assert({
        given: 'a cleaned video journal',
        should: 'review suggested types after corrections, retain the video, and respect a stated filing time',
        actual: [
          options.source,
          options.when.toString(),
          options.kind,
          options.split,
          options.reviewTypes,
          options.cleanedText,
        ],
        expected: [
          source,
          stated ? when.toString() : '2031-03-16 09:00',
          'Video',
          'auto',
          true,
          'Jane Doe helped with Atlas.',
        ],
      })
      return CommandResult.success({ files: ['journal/Atlas.md', 'journal/Health.md'] })
    })
    try {
      const result = await journalFromVideo({ videoPath: source, when, whenStated: stated, context, tasks })
      assert({
        given: `transcription ${succeeds ? 'succeeds' : 'fails'}`,
        should: 'clean up extracted audio while preserving the video and complete result list',
        actual: [result.ok, await exists(audio), await readFile(source, 'utf8'), file.mock.calls.length, result.data],
        expected: [
          succeeds,
          false,
          'synthetic video',
          succeeds ? 1 : 0,
          succeeds ? { files: ['journal/Atlas.md', 'journal/Health.md'] } : undefined,
        ],
      })
    } finally {
      file.mockRestore()
      clean.mockRestore()
      open.mockRestore()
      extract.mockRestore()
      probe.mockRestore()
      await rm(base, { recursive: true, force: true })
    }
  }
})
