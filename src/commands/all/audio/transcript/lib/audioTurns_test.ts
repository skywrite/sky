import { spyOn } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { resolveCommandArgs } from '#commands/lib/core/resolveCommandArgs.ts'
import { CommandPlatform } from '#commands/mod.ts'
import * as config from '#config'
import * as sys from '#lib/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import AudioTranscriptCreateTask from '../create.ts'
import { audioTurnsKey, transcribeAudioTurns } from './audioTurns.ts'
import * as transcription from './transcribe.ts'
import * as runs from './transcriptRun.ts'

test('audio conversation retries reuse completed turns and preserve boundaries without diarization', async () => {
  const root = await mkdtemp('/tmp/sky-audio-turns-')
  const source = path.join(root, 'source')
  await mkdir(source)
  const files = ['first.caf', 'reply.CAF'].map((name) => path.join(source, name))
  const words = ['Can we review the Atlas plan?', 'Yes, I will send the revised plan.']
  for (const [index, file] of files.entries()) await writeFile(file, words[index])
  const now = new ZonedDateTime('2031-03-13 09:15', 'UTC')
  const context = CommandContext.test(config, { notebookNow: now, systemNow: now }).fork({
    platform: CommandPlatform.Server,
    compositionDepth: 2,
  })
  const options = { dir: path.join(root, 'runs'), now: () => now.plainDateTime.toString() }
  const runOptions = spyOn(runs, 'runOptionsFor').mockReturnValue(options)
  const command = spyOn(sys, 'runCommand').mockImplementation(async (name, args = []) => {
    if (name === 'ffmpeg') await copyFile(args[1], args.at(-1)!)
    else if (name !== 'which') throw new Error(`Unexpected command: ${name}`)
    return { success: true, code: 0, stdout: '', stderr: '' }
  })
  const recognized: string[] = []
  let fail = true
  const recognize = spyOn(transcription, 'transcribeWithOpenAI').mockImplementation(async (bytes) => {
    const text = new TextDecoder().decode(bytes)
    recognized.push(text)
    if (fail && text === words[1]) throw new Error('Synthetic recognition failure')
    return { text, durationSeconds: 15 }
  })
  const tasks = new CommandService(context)
  const child = spyOn(tasks, 'run').mockImplementation(async (name, overrides) => {
    if (name !== 'audio:transcript:create') throw new Error(`Unexpected command: ${name}`)
    const args = await resolveCommandArgs({
      description: AudioTranscriptCreateTask.description,
      callerArgs: {},
      overrides: { ...overrides, provider: 'openai', glossary: false },
      callerDepth: 2,
    })
    return new AudioTranscriptCreateTask().run({ args, context } as Parameters<AudioTranscriptCreateTask['run']>[0])
  })
  try {
    let error = ''
    try {
      await transcribeAudioTurns(files, { context, tasks })
    } catch (err) {
      error = (err as Error).message
    }
    fail = false
    const result = await transcribeAudioTurns(files, { context, tasks })
    const reused = await transcribeAudioTurns(files, { context, tasks })
    const key = await audioTurnsKey(files)
    assert({
      given: 'the second CAF fails, then the conversation is retried twice',
      should: 'transcribe only the missing turn and retain separate numbered turns in the requested order',
      actual: [
        error.startsWith('Audio file 2:'),
        recognized,
        result.text,
        reused.text,
        result.run.key === key,
        (await readdir(source)).sort(),
      ],
      expected: [
        true,
        [words[0], words[1], words[1]],
        `### Turn 1\n\n${words[0]}\n\n### Turn 2\n\n${words[1]}`,
        result.text,
        true,
        ['first.caf', 'reply.CAF'],
      ],
    })
    await copyFile(files[0], path.join(root, 'renamed.caf'))
    assert({
      given: 'renamed files, reversed turns, or the same clip used for two turns',
      should: 'reuse renamed content, distinguish order, and retain repeated turns',
      actual: [
        (await audioTurnsKey([path.join(root, 'renamed.caf'), files[1]])) === key,
        (await audioTurnsKey([...files].reverse())) !== key,
        (await transcribeAudioTurns([files[0], files[0]], { context, tasks })).text,
      ],
      expected: [true, true, `### Turn 1\n\n${words[0]}\n\n### Turn 2\n\n${words[0]}`],
    })
    recognized.length = 0
    await transcribeAudioTurns(files, { context, tasks }, true)
    assert({
      given: 'Start over',
      should: 'clear both child recognition checkpoints',
      actual: recognized,
      expected: words,
    })
    assert({
      given: 'CAF conversion finished',
      should: 'keep originals and remove temporary audio conversions',
      actual: [
        await Promise.all(files.map((file) => readFile(file, 'utf8'))),
        (await readdir(result.run.dir, { recursive: true })).filter((name) => name.endsWith('.m4a')),
      ],
      expected: [words, []],
    })
    await result.run.clear()
    assert({
      given: 'conversation completion',
      should: 'remove all its retry checkpoints',
      actual: await readdir(result.run.dir).catch(() => null),
      expected: null,
    })
  } finally {
    child.mockRestore()
    recognize.mockRestore()
    command.mockRestore()
    runOptions.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
