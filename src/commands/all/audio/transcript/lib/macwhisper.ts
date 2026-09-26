import { constants } from 'node:fs'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import * as path from 'node:path'
import { getCommandPath, runCommand } from '#lib/sys/mod.ts'
import type { AudioTranscriptionOptions } from './audio.ts'
import { isLocalMacWhisperModel, type MacWhisperModel, type MacWhisperModels } from './models.ts'
import type { Transcription } from './transcribe.ts'

export interface MacWhisperHost {
  cli: () => Promise<string>
  run: typeof runCommand
}

const host: MacWhisperHost = { cli: findMacWhisperCli, run: runCommand }

/** Services need not inherit the shell's PATH; a normal app install already includes mw. */
export async function findMacWhisperCli(): Promise<string> {
  if (platform() !== 'darwin') throw new Error('MacWhisper requires Sky to run on a Mac.')
  const candidates = [
    '/Applications/MacWhisper.app/Contents/MacOS/mw',
    path.join(homedir(), 'Applications/MacWhisper.app/Contents/MacOS/mw'),
    '/usr/local/bin/mw',
    '/opt/homebrew/bin/mw',
    await getCommandPath('mw'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next supported install location.
    }
  }
  throw new Error(
    'Install or update MacWhisper on the Mac running Sky. In MacWhisper Settings → Advanced, install the command-line tool if Sky still cannot find it.',
  )
}

/** mw currently emits a whitespace-aligned table, not JSON. Keep names and sizes intact. */
export function parseMacWhisperModels(output: string): MacWhisperModel[] {
  const models: MacWhisperModel[] = []
  for (const line of output.split(/\r?\n/)) {
    const row = line.trim().match(/^(▸\s*)?(\S+:\S+)\s{2,}(.+?)\s{2,}(-|[\d.]+\s*[KMGT]?B)\s*$/)
    if (!row || !isLocalMacWhisperModel(row[2]) || models.some((model) => model.id === row[2])) continue
    models.push({ id: row[2], name: row[3].trim(), size: row[4] === '-' ? null : row[4], current: Boolean(row[1]) })
  }
  const onlyHeader = /^\s*ID\s+NAME\s+SIZE\s*$/.test(output)
  if (
    !models.length &&
    !onlyHeader &&
    !/no (?:(?:downloaded|installed)(?: transcription)? models|models (?:downloaded|installed))/i.test(output)
  ) {
    throw new Error('Could not read MacWhisper’s installed models. Update MacWhisper, then refresh the models.')
  }
  return models
}

async function installedModels(
  cli: string,
  signal: AbortSignal | undefined,
  run: typeof runCommand,
): Promise<MacWhisperModel[]> {
  const result = await run(cli, ['models', 'list'], { signal, timeout: 15000, killSignal: 'SIGINT' })
  signal?.throwIfAborted()
  if (!result.success)
    throw new Error(`Could not load MacWhisper models. Open MacWhisper and try again. ${result.stderr.trim()}`)
  return parseMacWhisperModels(result.stdout)
}

export async function getMacWhisperModels(runtime: MacWhisperHost = host): Promise<MacWhisperModels> {
  try {
    return { available: true, models: await installedModels(await runtime.cli(), undefined, runtime.run), error: null }
  } catch (error) {
    return { available: false, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function transcribeWithMacWhisper(
  audioData: Uint8Array,
  fileName: string,
  options: AudioTranscriptionOptions = {},
  runtime: MacWhisperHost = host,
): Promise<Transcription> {
  options.signal?.throwIfAborted()
  const cli = await runtime.cli()
  const models = await installedModels(cli, options.signal, runtime.run)
  const requested = options.model?.slice('macwhisper/'.length) ?? 'default'
  const model =
    requested === 'default'
      ? (models.find((entry) => entry.current) ?? models[0])
      : models.find((entry) => entry.id === requested)
  if (!model)
    throw new Error(
      'The selected MacWhisper model is not installed. Download a local model in MacWhisper, then choose it in Settings → AI → Audio transcription.',
    )
  options.signal?.throwIfAborted()
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-macwhisper-'))
  try {
    // A private temporary input is required by mw; never keep a second audio copy or app history.
    const input = path.join(dir, `recording${path.extname(fileName).toLowerCase() || '.wav'}`)
    await writeFile(input, audioData, { mode: 0o600 })
    options.signal?.throwIfAborted()
    const result = await runtime.run(
      cli,
      [
        'transcribe',
        input,
        '--model',
        model.id,
        '--format',
        'txt',
        '--no-timestamps',
        options.diarize ? '--speakers' : '--no-speakers',
      ],
      { signal: options.signal, killSignal: 'SIGINT', maxBuffer: 16 * 1024 * 1024 },
    )
    options.signal?.throwIfAborted()
    if (!result.success)
      throw new Error(`MacWhisper transcription failed: ${result.stderr.trim() || 'Open MacWhisper and try again.'}`)
    const text = result.stdout.trim()
    if (!text) throw new Error('MacWhisper returned an empty transcript.')
    return { text }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
