import { access, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import {
  getMacWhisperModels,
  parseMacWhisperModels,
  transcribeWithMacWhisper,
  type MacWhisperHost,
} from './macwhisper.ts'
import { resolveTranscriptionModel, transcriptionUploadLimit } from './models.ts'

const MODEL_TABLE = `  ID                          NAME                  SIZE
  whisperkit:sample-small     Sample Small          100 MB
▸ whisper-cpp:sample-large    Sample Large          1.5 GB
  apple:xx-XX                 Sample Language       -
  openai:sample-cloud         Sample Cloud          -
`
const ok = (stdout: string) => ({ success: true, code: 0, stdout, stderr: '' })

test('MacWhisper discovery reads local names, sizes and the selected model without accepting cloud models', async () => {
  const models = parseMacWhisperModels(MODEL_TABLE)
  const missing = await getMacWhisperModels({
    cli: async () => {
      throw new Error('MacWhisper is not installed.')
    },
    run: async () => ok(''),
  })
  let invalid = false
  try {
    parseMacWhisperModels('Unexpected protocol output')
  } catch {
    invalid = true
  }
  assert({
    given: 'the CLI table, an empty installation, unexpected output, and a missing app',
    should: 'return local models faithfully and surface discovery failures',
    actual: [models, parseMacWhisperModels('No models downloaded.'), invalid, missing],
    expected: [
      [
        { id: 'whisperkit:sample-small', name: 'Sample Small', size: '100 MB', current: false },
        { id: 'whisper-cpp:sample-large', name: 'Sample Large', size: '1.5 GB', current: true },
        { id: 'apple:xx-XX', name: 'Sample Language', size: null, current: false },
      ],
      [],
      true,
      { available: false, models: [], error: 'MacWhisper is not installed.' },
    ],
  })
})

test('MacWhisper uses the chosen installed model and removes temporary audio after success, failure and cancellation', async () => {
  const files: string[] = []
  const calls: string[][] = []
  const contents: number[][] = []
  const outcomes: string[] = []
  for (const mode of ['success', 'failure', 'cancel', 'empty']) {
    const controller = new AbortController()
    const runtime: MacWhisperHost = {
      cli: async () => '/mock/mw',
      run: async (_cli, args = [], options = {}) => {
        if (args[0] === 'models') return ok(MODEL_TABLE)
        files.push(args[1])
        calls.push(args)
        contents.push([...(await readFile(args[1]))])
        assert({
          given: 'an active transcription',
          should: 'carry cancellation to mw as SIGINT',
          actual: [options.signal === controller.signal, options.killSignal],
          expected: [true, 'SIGINT'],
        })
        if (mode === 'cancel') controller.abort()
        if (mode === 'failure') return { ...ok(''), success: false, code: 1, stderr: 'Model failed to load.' }
        return ok(mode === 'empty' ? ' ' : 'Sample transcript.\n')
      },
    }
    try {
      const result = await transcribeWithMacWhisper(
        new Uint8Array([1, 2, 3]),
        '../../sample.wav',
        {
          model: mode === 'success' ? 'macwhisper/whisperkit:sample-small' : 'macwhisper/default',
          signal: controller.signal,
        },
        runtime,
      )
      outcomes.push(result.text)
    } catch (error) {
      outcomes.push(controller.signal.aborted ? 'cancelled' : error instanceof Error ? error.message : String(error))
    }
  }
  const cleaned = await Promise.all(
    files.map((file) =>
      access(path.dirname(file)).then(
        () => false,
        () => true,
      ),
    ),
  )
  assert({
    given: 'successful, failed, cancelled and empty transcriptions',
    should:
      'use explicit or current local models, pass plain text without persisting app history, and always remove audio',
    actual: [outcomes, contents, cleaned, calls.map((args) => args.slice(2)), new Set(files).size],
    expected: [
      [
        'Sample transcript.',
        'MacWhisper transcription failed: Model failed to load.',
        'cancelled',
        'MacWhisper returned an empty transcript.',
      ],
      Array.from({ length: 4 }, () => [1, 2, 3]),
      [true, true, true, true],
      [
        'whisperkit:sample-small',
        'whisper-cpp:sample-large',
        'whisper-cpp:sample-large',
        'whisper-cpp:sample-large',
      ].map((id) => ['--model', id, '--format', 'txt', '--no-timestamps', '--no-speakers']),
      4,
    ],
  })
})

test('MacWhisper refuses missing or cloud models and pre-cancelled requests before starting transcription', async () => {
  let runs = 0
  let transcriptions = 0
  const runtime: MacWhisperHost = {
    cli: async () => '/mock/mw',
    run: async (_cli, args = []) => {
      runs++
      if (args[0] === 'transcribe') transcriptions++
      return ok(MODEL_TABLE)
    },
  }
  const refused: boolean[] = []
  for (const model of ['macwhisper/whisperkit:missing', 'macwhisper/openai:sample-cloud', 'macwhisper/default']) {
    try {
      await transcribeWithMacWhisper(
        new Uint8Array(),
        'sample.wav',
        { model, ...(model.endsWith('/default') ? { signal: AbortSignal.abort() } : {}) },
        runtime,
      )
      refused.push(false)
    } catch {
      refused.push(true)
    }
  }
  assert({
    given: 'invalid models and a cancelled request',
    should: 'never transcribe or silently fall back',
    actual: [refused, runs, transcriptions],
    expected: [[true, true, true], 2, 0],
  })
})

test('saved MacWhisper model IDs survive CLI overrides and remove only the local upload cap', () => {
  const saved = 'macwhisper/whisperkit:sample-small'
  assert({
    given: 'a saved local model and an explicit provider override',
    should: 'preserve the model for MacWhisper and keep cloud limits intact',
    actual: [
      resolveTranscriptionModel(saved, 'macwhisper').value,
      resolveTranscriptionModel(saved, 'mistral').value,
      transcriptionUploadLimit(saved),
      transcriptionUploadLimit('openai/gpt-transcribe'),
      transcriptionUploadLimit('mistral/voxtral-mini-latest'),
    ],
    expected: [saved, 'mistral/voxtral-mini-latest', Infinity, 25 * 1024 * 1024, 500 * 1024 * 1024],
  })
})
