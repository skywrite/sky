import { spyOn } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import AudioTranscriptCreateTask from '#commands/all/audio/transcript/create.ts'
import * as transcription from '#commands/all/audio/transcript/lib/audio.ts'
import * as runs from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import VideoNewTask from '#commands/all/video/new.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { probeMedia, runFfmpeg } from '#lib/media/ffmpeg/mod.ts'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import * as settings from '#shared/config/loader.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { createImportHost } from './createImportHost.ts'
import { startArgs } from './startArgs.ts'

const available = (await isCommandAvailable('ffmpeg')) && (await isCommandAvailable('ffprobe'))

async function makeVideo(file: string) {
  await runFfmpeg('ffmpeg', [
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=16x16:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-shortest',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    file,
  ])
}

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
      await makeVideo(video)
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
        should: 'offer Video first and Journal second, explain silent recordings, and enforce the cap on audio files',
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
        expected: [
          'video',
          ['video', 'journal'],
          null,
          [],
          'silent.mp4 has no audio track. Drop it together with an SRT, VTT or TXT transcript, or choose a recording with audio.',
          'audio',
          true,
          true,
          null,
        ],
      })
    } finally {
      load.mockRestore()
      await rm(base, { recursive: true, force: true })
    }
  },
)

test(
  'a standalone recording is transcribed, filed as a video, and playable from its document',
  { ignore: !available },
  async () => {
    const root = await mkdtemp('/tmp/sky-recording-import-')
    const base = path.join(root, 'notebook')
    const data = path.join(root, 'data')
    const time = path.join(base, 'time')
    const context = CommandContext.test({
      ...config,
      DIR_BASE: base,
      DIR_TIME: time,
      DIR_USER_DATA: data,
      DIR_ATTACHMENTS: path.join(data, 'attachments'),
      DIR_STATE: path.join(data, 'state'),
    })
    const recording = path.join(root, 'Demo.mp4')
    const captured = path.join(root, 'recognition-input.m4a')
    const words = 'Here is the complete Atlas demonstration.'
    const when = new PlainDateTime('2031-04-05 09:30')
    const runOptions = spyOn(runs, 'runOptionsFor').mockReturnValue({
      dir: path.join(root, 'runs'),
      now: () => when.toString(),
    })
    const recognize = spyOn(transcription, 'transcribeAudio').mockImplementation(async (audio) => {
      await writeFile(captured, audio)
      return { text: words }
    })
    const tasks = new CommandService(context)
    // Stub the write-up, using the real transcription command on the input video:new supplies.
    let failWriteup = true
    const summary = spyOn(tasks, 'run').mockImplementation(async (command, args) => {
      if (command !== 'audio:transcript:summary' || !args?.fromAudio)
        throw new Error('Expected a recording to summarize.')
      const raw = await new AudioTranscriptCreateTask().run({
        context: context.fork({ compositionDepth: 1 }),
        args: { file: args.fromAudio, run: args.run, provider: 'openai', glossary: false },
      } as Parameters<AudioTranscriptCreateTask['run']>[0])
      if (!raw.ok || !raw.data) return CommandResult.fail(raw.message ?? 'Transcription failed.')
      if (failWriteup) return CommandResult.fail('The write-up was interrupted.')
      return CommandResult.success({
        title: 'Atlas demonstration',
        body: '## Summary\n\nThe recording demonstrates Atlas.',
        cleanedText: raw.data.transcript,
        time: when.toString(),
        rel: [],
        run: raw.data.run,
      })
    })
    try {
      await makeVideo(recording)
      const bytes = await readFile(recording)
      const key = await runs.sha256Of(recording)
      const start = startArgs(
        { source: 'video', suggestedWhen: when.toString(), runKey: key },
        { kind: 'video', category: 'Professional', when: when.toString(), journalType: null, fresh: false },
        recording,
      )
      const importRecording = () =>
        new VideoNewTask().run({
          args: { ...start.args, noAutoTag: true, noAutoRel: true },
          context,
          tasks,
          rawArgs: start.rawArgs,
        } as Parameters<VideoNewTask['run']>[0])
      const failed = await importRecording()
      assert({
        given: 'a write-up that fails after speech recognition',
        should: 'keep the recognition checkpoint and publish no entry',
        actual: [
          failed.message,
          await readdir(time).catch(() => []),
          (await readdir(path.join(root, 'runs', key))).sort(),
        ],
        expected: ['The write-up was interrupted.', [], ['raw.json', 'run.json']],
      })
      failWriteup = false
      const result = await importRecording()
      if (!result.ok || !result.data?.filePath) throw new Error(result.message || 'No video was filed.')
      const file = result.data.filePath
      const doc = VideoDocument.fromMarkdown(await readFile(file, 'utf8'))
      const media = await probeMedia(captured)
      const app = createTestHttpApp([time], { userDataDir: data })
      const url = '/docs/_api/file/' + path.join(path.relative(base, path.dirname(file)), doc.attachments[0].file)
      const playback = await app.request(url)
      const seek = await app.request(url, { headers: { Range: 'bytes=10-29' } })
      assert({
        given: 'a retry of the same recording',
        should: 'use the original file key and recognize only the extracted audio once',
        actual: [
          summary.mock.calls[0][1]?.fromAudio,
          summary.mock.calls[0][1]?.run,
          recognize.mock.calls.length,
          media.hasAudio,
          media.hasVideo,
          await readdir(path.join(root, 'runs')),
        ],
        expected: [recording, key, 1, true, false, []],
      })
      assert({
        given: 'a recording dropped without a URL or captions',
        should: 'file its write-up and full transcript in Videos and link the entry from the day',
        actual: {
          medium: doc.medium,
          title: doc.summary,
          folder: path.basename(path.dirname(file)),
          transcript: doc.markdown.includes('## Transcript\n\n' + words),
          linked: (await readFile(path.join(time, dayFile(when.plainDate)), 'utf8')).includes(path.basename(file)),
        },
        expected: { medium: 'Video', title: 'Atlas demonstration', folder: 'videos', transcript: true, linked: true },
      })
      assert({
        given: 'the saved video attachment',
        should: 'play and seek through the original bytes and preserve the source file',
        actual: [
          doc.attachments.length,
          playback.headers.get('Content-Type'),
          bytes.equals(Buffer.from(await playback.arrayBuffer())),
          seek.status,
          bytes.subarray(10, 30).equals(Buffer.from(await seek.arrayBuffer())),
          (await readFile(recording)).equals(bytes),
        ],
        expected: [1, 'video/mp4', true, 206, true, true],
      })
    } finally {
      summary.mockRestore()
      recognize.mockRestore()
      runOptions.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  },
)
