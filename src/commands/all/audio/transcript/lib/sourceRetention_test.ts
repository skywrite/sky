import { spyOn } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import MeetingNewTask from '#commands/all/meeting/new.ts'
import MessageNewTask from '#commands/all/message/new.ts'
import NotesNewTask from '#commands/all/notes/new.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { resolveCommandArgs } from '#commands/lib/core/resolveCommandArgs.ts'
import type { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { CommandPlatform, CommandResult, type CommandArgs } from '#commands/mod.ts'
import * as config from '#config'
import * as nbfs from '#lib/nbfs/mod.ts'
import * as personFacts from '#lib/notebook/enrich/distillPersonFacts.ts'
import * as sys from '#lib/sys/mod.ts'
import * as chatDocument from '#shared/models/Chat/document/mod.ts'
import * as promptLoader from '#shared/prompts/load.ts'
import * as prompts from '#shared/prompts/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import AudioTranscriptCleanTask from '../clean.ts'
import AudioTranscriptCreateTask from '../create.ts'
import * as entities from './entityLists.ts'
import * as glossary from './glossary.ts'
import * as transcription from './transcribe.ts'
import * as runs from './transcriptRun.ts'

const NOW = '2031-03-13 09:15'
const WORDS = 'Jane Doe and I agreed to review the Atlas proposal on Friday.'

async function world(extension = 'm4a') {
  const root = await mkdtemp('/tmp/sky-memo-retention-')
  const sourceDir = path.join(root, 'source')
  await mkdir(sourceDir)
  const audio = path.join(sourceDir, `memo.${extension}`)
  await writeFile(audio, 'mock recording bytes')
  const now = new ZonedDateTime(NOW, 'UTC')
  const context = CommandContext.test(
    { ...config, DIR_ATTACHMENTS: path.join(root, 'attachments') },
    { notebookNow: now, systemNow: now },
  ).fork({ platform: CommandPlatform.Server, compositionDepth: 1 })
  const options = { dir: path.join(root, 'runs'), now: () => NOW }
  const runOptions = spyOn(runs, 'runOptionsFor').mockReturnValue(options)
  const run = await runs.TranscriptRun.forFile(audio, options)
  return {
    root,
    sourceDir,
    audio,
    context,
    run,
    async close() {
      runOptions.mockRestore()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('audio cleaning keeps the words in memory without saving a transcript', async () => {
  const w = await world()
  const title = path.basename(w.root)
  await writeFile(path.join(w.sourceDir, 'memo.md'), 'Existing unrelated note')
  await w.run.put('raw', { text: WORDS, durationSeconds: 90, language: 'en' })
  await w.run.put('analysis', { analysis: { issues: [], who: [], rel: [], summary: 'Review the proposal.' } })
  await w.run.put('review', { corrections: [] })
  const modelInputs: unknown[] = []
  const mocks = [
    spyOn(entities, 'fetchPeople').mockResolvedValue(''),
    spyOn(entities, 'fetchOrgs').mockResolvedValue(''),
    spyOn(entities, 'fetchProjects').mockResolvedValue(''),
    spyOn(glossary, 'loadGlossary').mockResolvedValue(null),
    spyOn(promptLoader, 'readPromptFile').mockResolvedValue('Synthetic analysis prompt'),
    spyOn(prompts, 'renderPromptFile').mockImplementation((_content, _file, input) => {
      modelInputs.push(input?.user?.input)
      return { output: 'Synthetic analysis prompt', warnings: [] }
    }),
  ]
  const tasks = new CommandService(w.context)
  const child = spyOn(tasks, 'run').mockImplementation(async (name, overrides) => {
    if (name === 'person:list:last') return CommandResult.success({ people: [] })
    if (name !== 'audio:transcript:create') throw new Error(`Unexpected command: ${name}`)
    const args = await resolveCommandArgs({
      description: AudioTranscriptCreateTask.description,
      callerArgs: { title },
      overrides,
      callerDepth: 1,
    })
    return new AudioTranscriptCreateTask().run({ args, context: w.context } as Parameters<
      AudioTranscriptCreateTask['run']
    >[0])
  })
  try {
    const result = await new AudioTranscriptCleanTask().run({
      args: {
        fromAudio: w.audio,
        title,
        save: false,
        fresh: false,
        file: undefined,
        fromZoomVtt: undefined,
        fromSrt: undefined,
        fromText: undefined,
        output: undefined,
        run: undefined,
      },
      context: w.context,
      tasks,
      rawArgs: { _: [] },
    })
    assert({
      given: 'an imported memo and a pre-existing markdown file with the same name',
      should: 'return just the spoken words and leave both source files untouched',
      actual: {
        ok: result.ok,
        text: result.data?.cleanedText,
        outputPath: result.data?.outputPath,
        transcriptFilePath: result.data?.transcriptFilePath,
        modelInputs,
        files: (await readdir(w.sourceDir)).sort(),
        note: await readFile(path.join(w.sourceDir, 'memo.md'), 'utf8'),
        audio: await readFile(w.audio, 'utf8'),
        retryText: (await w.run.get('raw'))?.data.text,
      },
      expected: {
        ok: true,
        text: WORDS,
        outputPath: null,
        transcriptFilePath: null,
        modelInputs: [WORDS],
        files: ['memo.m4a', 'memo.md'],
        note: 'Existing unrelated note',
        audio: 'mock recording bytes',
        retryText: WORDS,
      },
    })
  } finally {
    child.mockRestore()
    for (const mock of mocks) mock.mockRestore()
    await rm(`/tmp/transcript-clean-${title}.md`, { force: true })
    await w.close()
  }
})

test('an explicit standalone transcript export still saves the requested file', async () => {
  const w = await world()
  await w.run.put('raw', { text: WORDS, durationSeconds: 90, language: 'en' })
  try {
    const result = await new AudioTranscriptCreateTask().run({
      args: {
        file: w.audio,
        save: true,
        delete: false,
        fresh: false,
        title: 'Memo export',
        provider: 'openai',
        diarize: false,
        glossary: false,
      },
      context: w.context.fork({ compositionDepth: 0 }),
    } as Parameters<AudioTranscriptCreateTask['run']>[0])
    const output = path.join(w.sourceDir, 'memo.md')
    assert({
      given: 'audio:transcript:create with --save',
      should: 'save the transcript, preserve the recording, and remove the retry record',
      actual: {
        ok: result.ok,
        path: result.data?.outputPath,
        hasWords: (await readFile(output, 'utf8')).includes(WORDS),
        files: (await readdir(w.sourceDir)).sort(),
        retry: await w.run.get('raw'),
      },
      expected: { ok: true, path: output, hasWords: true, files: ['memo.m4a', 'memo.md'], retry: null },
    })
  } finally {
    await w.close()
  }
})

for (const fail of [false, true]) {
  test(`CAF conversion leaves no audio copy after transcription ${fail ? 'fails' : 'succeeds'}`, async () => {
    const w = await world('caf')
    await writeFile(path.join(w.sourceDir, 'memo.m4a'), 'Existing audio')
    const conversions: string[] = []
    const command = spyOn(sys, 'runCommand').mockImplementation(async (name, args = []) => {
      if (name === 'ffmpeg') {
        const target = args.at(-1)!
        conversions.push(target)
        await writeFile(target, 'Converted mock audio')
      } else if (name !== 'which') throw new Error(`Unexpected command: ${name}`)
      return { success: true, code: 0, stdout: '', stderr: '' }
    })
    const transcribe = spyOn(transcription, 'transcribeWithOpenAI').mockImplementation(async (_data, _name, opts) => {
      if (fail) throw new Error('Synthetic transcription failure')
      opts?.onDelta?.(WORDS)
      return { text: WORDS, durationSeconds: 90 }
    })
    try {
      const result = await new AudioTranscriptCreateTask().run({
        args: {
          file: w.audio,
          save: false,
          delete: false,
          fresh: false,
          title: 'Memo',
          provider: 'openai',
          diarize: false,
          glossary: false,
        },
        context: w.context,
      } as Parameters<AudioTranscriptCreateTask['run']>[0])
      const log = (w.context.output as BufferedOutput).getLogs().join('\n')
      assert({
        given: 'a CAF memo with a neighboring M4A file',
        should: 'use a temporary conversion, preserve the originals, and stream successful words once',
        actual: {
          ok: result.ok,
          source: result.data?.inputFile,
          audio: await readFile(w.audio, 'utf8'),
          neighbor: await readFile(path.join(w.sourceDir, 'memo.m4a'), 'utf8'),
          files: (await readdir(w.sourceDir)).sort(),
          conversionCount: conversions.length,
          temporary: conversions.every((file) => path.dirname(file) === w.run.dir),
          convertedFiles: (await readdir(w.run.dir)).filter((file) => file.endsWith('.m4a')),
          spokenCopies: log.split(WORDS).length - 1,
          metadata: log.includes('source_file:'),
        },
        expected: {
          ok: !fail,
          source: fail ? undefined : w.audio,
          audio: 'mock recording bytes',
          neighbor: 'Existing audio',
          files: ['memo.caf', 'memo.m4a'],
          conversionCount: 1,
          temporary: true,
          convertedFiles: [],
          spokenCopies: fail ? 0 : 1,
          metadata: false,
        },
      })
    } finally {
      transcribe.mockRestore()
      command.mockRestore()
      await w.close()
    }
  })
}

for (const Task of [MeetingNewTask, NotesNewTask, MessageNewTask]) {
  test(`${Task.description.name} files a memo without audio or transcript attachments`, async () => {
    const w = await world()
    const documents = path.join(w.root, 'documents')
    const body = '## Summary\n\nReview the Atlas proposal on Friday.'
    const writes: string[] = []
    const mocks = [
      spyOn(nbfs.DayDirFileWriter.prototype, 'write').mockImplementation(async (file, content) => {
        const target = path.join(documents, file)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, content)
        writes.push(target)
        return file
      }),
      spyOn(nbfs, 'writeDayItems').mockResolvedValue(),
      spyOn(personFacts, 'distillPersonFactsFromText').mockResolvedValue(undefined),
      spyOn(chatDocument, 'userSpeakerLabel').mockReturnValue('Notebook owner'),
    ]
    const tasks = new CommandService(w.context)
    const child = spyOn(tasks, 'run').mockResolvedValue(
      CommandResult.success({
        run: null,
        title: 'Atlas proposal review',
        body,
        cleanedText: WORDS,
        who: ['Jane Doe'],
        rel: [],
        time: NOW,
        durationMinutes: null,
        medium: 'Phone',
        actionItems: [],
        from: 'Jane Doe',
        to: 'Notebook owner',
        audioFilePath: w.audio,
        transcriptFilePath: null,
      }),
    )
    try {
      const args = {
        ...(Task === MeetingNewTask ? { fromVoiceMemo: w.audio } : { fromAudio: w.audio }),
        when: new PlainDateTime(NOW),
        category: 'Professional Complete',
        noAutoTag: true,
        noAutoRel: true,
        noActions: true,
        fresh: false,
      }
      const result = await new Task().run({ args, context: w.context, tasks, rawArgs: { _: [] } } as CommandArgs<any>)
      const filed = writes.length === 1 ? await readFile(writes[0], 'utf8') : ''
      const attachments = await readdir(w.context.config.DIR_ATTACHMENTS, { recursive: true }).catch(() => [])
      assert({
        given: 'a voice memo imported from the web',
        should: 'file its write-up without the transcript or a retained audio copy',
        actual: {
          ok: result.ok,
          writes: writes.length,
          hasWriteup: filed.includes(body),
          hasTranscript: filed.includes(WORDS) || filed.includes('## Transcript'),
          hasAttachments: /^attachments:/m.test(filed),
          attachments,
          sourceFiles: await readdir(w.sourceDir),
          source: await readFile(w.audio, 'utf8').catch(() => null),
        },
        expected: {
          ok: true,
          writes: 1,
          hasWriteup: true,
          hasTranscript: false,
          hasAttachments: false,
          attachments: [],
          sourceFiles: ['memo.m4a'],
          source: 'mock recording bytes',
        },
      })
    } finally {
      child.mockRestore()
      for (const mock of mocks) mock.mockRestore()
      await w.close()
    }
  })
}
