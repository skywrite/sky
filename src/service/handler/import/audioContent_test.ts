import { spyOn } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import AudioTranscriptCreateTask from '#commands/all/audio/transcript/create.ts'
import * as transcription from '#commands/all/audio/transcript/lib/transcribe.ts'
import * as runs from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { CommandPlatform } from '#commands/mod.ts'
import * as config from '#config'
import { audioContainerFromHeader } from '#lib/media/audioHeader.ts'
import { runFfmpeg } from '#lib/media/ffmpeg/mod.ts'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import * as settings from '#shared/config/loader.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { silentCaf } from '../../../test/audioFixtures.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { createImportHost } from './createImportHost.ts'
import type { ImportJob } from './jobs.ts'

const available = (await isCommandAvailable('ffmpeg')) && (await isCommandAvailable('ffprobe'))

async function world() {
  const root = await mkdtemp('/tmp/sky-audio-contents-')
  const disguisedCaf = path.join(root, 'reply.m4a')
  const disguisedM4a = path.join(root, 'memo.caf')
  const invalid = path.join(root, 'broken.m4a')
  await writeFile(disguisedCaf, silentCaf())
  await writeFile(invalid, 'This is not a recording.')
  await runFfmpeg('ffmpeg', ['-y', '-i', disguisedCaf, '-c:a', 'aac', '-f', 'ipod', disguisedM4a])
  const defaults = settings.loadSkyConfig(path.join(root, 'missing-config.jsonc'))
  const settingsRead = spyOn(settings, 'loadSkyConfig').mockReturnValue(defaults)
  return {
    root,
    disguisedCaf,
    disguisedM4a,
    invalid,
    close: async () => {
      settingsRead.mockRestore()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test(
  'the upload reads audio contents before routing, grouping, or accepting recordings',
  { ignore: !available },
  async () => {
    const w = await world()
    try {
      const read = createImportHost(config, {}).read
      let listens = 0
      const app = createTestHttpApp([w.root], {
        imports: {
          dir: path.join(w.root, 'imports'),
          journalTypes: [],
          read,
          suggestWhen: () => '2031-03-13 09:30',
          listen: async () => {
            listens++
            return null
          },
          run: async function* () {
            throw new Error('This test never transcribes an upload.')
          },
        },
      })
      const form = new FormData()
      for (const name of ['reply.m4a', 'next.caf'])
        form.append('file', new File([silentCaf()], name, { type: 'audio/mp4' }))
      const response = await app.request('/import', { method: 'POST', body: form })
      const { job } = (await response.json()) as { job: ImportJob }
      assert({
        given: 'CAF recordings with mixed extensions and incorrect MIME types',
        should: 'keep one ordered conversation, preserve the bytes, and skip the voice memo classifier',
        actual: [
          response.status,
          job.readback.source,
          job.files?.map((f) => f.name),
          job.readback.refusal,
          listens,
          (await readFile(path.join(w.root, 'imports', job.id, 'reply.m4a'))).equals(Buffer.from(silentCaf())),
        ],
        expected: [201, 'imessage-audio', ['reply.m4a', 'next.caf'], null, 0, true],
      })
      const m4a = await readFile(w.disguisedM4a)
      const memo = await read({ path: w.disguisedM4a, name: 'memo.caf', size: m4a.length })
      const broken = await read({ path: w.invalid, name: 'broken.m4a', size: 24 })
      assert({
        given: 'a genuine M4A named .caf and non-audio contents named .m4a',
        should: 'offer normal recording choices for the M4A and refuse the invalid recording',
        actual: [memo.source, memo.kinds.includes('journal'), memo.refusal, broken.kinds, Boolean(broken.refusal)],
        expected: ['audio', true, null, [], true],
      })
    } finally {
      await w.close()
    }
  },
)

test(
  'transcription verifies the container, converts disguised CAF, and preserves originals',
  { ignore: !available },
  async () => {
    const w = await world()
    const runOptions = spyOn(runs, 'runOptionsFor').mockReturnValue({
      dir: path.join(w.root, 'runs'),
      now: () => '2031-03-13 09:30',
    })
    const calls: { name: string; container: string | null }[] = []
    const recognize = spyOn(transcription, 'transcribeWithOpenAI').mockImplementation(async (bytes, name) => {
      calls.push({ name, container: audioContainerFromHeader(bytes) })
      return { text: 'Synthetic transcript.', durationSeconds: 1 }
    })
    const now = new ZonedDateTime('2031-03-13 09:30', 'UTC')
    const context = CommandContext.test(config, { notebookNow: now, systemNow: now }).fork({
      platform: CommandPlatform.Server,
      compositionDepth: 1,
    })
    const transcribe = (file: string) =>
      new AudioTranscriptCreateTask().run({
        args: {
          file,
          save: false,
          delete: false,
          fresh: false,
          title: 'Memo',
          provider: 'openai',
          diarize: false,
          glossary: false,
        },
        context,
      } as Parameters<AudioTranscriptCreateTask['run']>[0])
    try {
      const before = await readFile(w.disguisedM4a)
      const caf = await transcribe(w.disguisedCaf)
      const m4a = await transcribe(w.disguisedM4a)
      const invalid = await transcribe(w.invalid)
      assert({
        given: 'CAF named .m4a, M4A named .caf, and invalid audio',
        should:
          'send valid containers with matching names, leave the sources intact, and refuse invalid input before recognition',
        actual: [
          caf.ok,
          m4a.ok,
          invalid.ok,
          calls,
          caf.data?.inputFile === w.disguisedCaf,
          m4a.data?.inputFile === w.disguisedM4a,
          (await readFile(w.disguisedCaf)).equals(Buffer.from(silentCaf())),
          (await readFile(w.disguisedM4a)).equals(before),
          (await readdir(path.join(w.root, 'runs'), { recursive: true })).filter((name) => name.endsWith('.m4a')),
        ],
        expected: [
          true,
          true,
          false,
          [
            { name: 'audio.m4a', container: 'mp4' },
            { name: 'memo.mp4', container: 'mp4' },
          ],
          true,
          true,
          true,
          true,
          [],
        ],
      })
    } finally {
      recognize.mockRestore()
      runOptions.mockRestore()
      await w.close()
    }
  },
)
