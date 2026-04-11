import * as path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import OpenAI, { toFile } from 'openai'
import colors from 'picocolors'
import { exists, readDir, writeTextFile } from '#shared/fs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Provider Types
// -----------------------------------------------------------------------------

type TranscriptionProvider = 'openai' | 'mistral'

interface MistralTranscriptionResponse {
  text: string
  segments?: Array<{
    start: number
    end: number
    text: string
    speaker?: string
  }>
}

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const AUDIO_EXTENSIONS = new Set(['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac', '.aac', '.caf'])

const params = {
  file: Arg.string('Path to audio file (optional - uses first audio file on Desktop if not provided)', {
    optional: true,
  }),
  output: Flag.string('Write to specific file path', {
    short: 'o',
    optional: true,
  }),
  save: Flag.boolean('Auto-save to source directory with .md extension', {
    short: 's',
    default: false,
  }),
  delete: Flag.boolean('Delete source audio file after transcription', {
    short: 'd',
    default: false,
  }),
  title: Flag.string('Title for the transcript', {
    short: 't',
    default: () => 'Transcript',
  }),
  provider: Flag.string('Transcription provider: openai or mistral', {
    short: 'p',
    default: () => 'openai' as TranscriptionProvider,
  }),
  diarize: Flag.boolean('Enable speaker diarization (mistral only)', {
    default: false,
  }),
}

type Params = InferParams<typeof params>

type Result = {
  transcript: string
  inputFile: string
  outputPath: string | null
  durationSeconds: number | undefined
  language: string | undefined
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'audio:transcript:create': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isAudioFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

async function findFirstAudioOnDesktop(): Promise<string | null> {
  const home = env.get('HOME')
  if (!home) return null

  const desktopPath = path.join(home, 'Desktop')

  if (!(await exists(desktopPath))) {
    return null
  }

  // Read desktop directory and find audio files
  const entries: string[] = []
  for await (const entry of readDir(desktopPath)) {
    if (entry.isFile && isAudioFile(entry.name)) {
      entries.push(path.join(desktopPath, entry.name))
    }
  }

  if (entries.length === 0) {
    return null
  }

  // Sort by name and return first one
  entries.sort()
  return entries[0]
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class AudioTranscriptCreateTask extends Command {
  static override description: CommandDescription = {
    name: 'audio:transcript:create',
    description: 'Create a transcript from an audio file using OpenAI or Mistral.',
    descriptionLong: [
      'Takes an audio file path, or if not provided, finds the first audio file on the Desktop.',
      '',
      'Providers:',
      '  - openai (default): Uses gpt-4o-transcribe model',
      '  - mistral: Uses voxtral-mini-latest model with optional speaker diarization',
      '',
      'By default, outputs to stdout for piping. Use --save to write a .md file next to the',
      'source audio, or --output to specify a custom path.',
    ],
    usage: [
      'sky audio:transcript:create recording.mp3           # Output to stdout (OpenAI)',
      'sky audio:transcript:create recording.mp3 -p mistral # Use Mistral Voxtral',
      'sky audio:transcript:create recording.mp3 -p mistral --diarize # With speaker ID',
      'sky audio:transcript:create recording.mp3 --save    # Save as recording.md',
      'sky audio:transcript:create recording.mp3 -o out.md # Save to specific path',
      'sky audio:transcript:create recording.mp3 -sd       # Save and delete source',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, title, output: outputPath, save, delete: deleteSource, provider, diarize } = args

    // Validate provider
    const validProviders: TranscriptionProvider[] = ['openai', 'mistral']
    if (!validProviders.includes(provider as TranscriptionProvider)) {
      return CommandResult.fail(`Invalid provider "${provider}". Must be one of: ${validProviders.join(', ')}`)
    }

    // 1. Determine input file
    let inputFile: string
    if (file) {
      inputFile = file
    } else {
      output.log(colors.gray('No file specified, searching Desktop for audio files...'))
      const foundFile = await findFirstAudioOnDesktop()
      if (!foundFile) {
        return CommandResult.fail('No audio file found on Desktop. Please specify a file path.')
      }
      inputFile = foundFile
      output.log(colors.cyan(`Found: ${path.basename(inputFile)}`))
    }

    // 2. Verify file exists
    if (!(await exists(inputFile))) {
      return CommandResult.fail(`File not found: ${inputFile}`)
    }

    output.log(colors.gray(`\nTranscribing: ${inputFile}`))

    // 3. Convert .caf to .m4a (unsupported by transcription APIs)
    let transcribeFile = inputFile
    let tempConvertedFile: string | null = null
    if (path.extname(inputFile).toLowerCase() === '.caf') {
      const ffmpegCheck = await runCommand('which', ['ffmpeg'])
      if (!ffmpegCheck.success) {
        return CommandResult.fail('ffmpeg is required to convert .caf files. Install with: brew install ffmpeg')
      }

      tempConvertedFile = path.join(path.dirname(inputFile), `${path.basename(inputFile, '.caf')}.m4a`)
      output.log(colors.gray(`Converting .caf → .m4a...`))
      const result = await runCommand('ffmpeg', ['-i', inputFile, '-y', '-c:a', 'aac', '-q:a', '2', tempConvertedFile])
      if (!result.success) {
        return CommandResult.fail(`ffmpeg conversion failed: ${result.stderr}`)
      }
      transcribeFile = tempConvertedFile
      inputFile = tempConvertedFile
    }

    // 4. Read the audio file
    let audioData: Uint8Array
    try {
      audioData = await readFile(transcribeFile)
    } catch (err) {
      return CommandResult.error(err as Error, `Failed to read audio file: ${transcribeFile}`)
    }

    output.log(colors.gray(`File size: ${(audioData.length / 1024 / 1024).toFixed(2)} MB`))

    // 4. Transcribe using selected provider
    const providerName = provider === 'mistral' ? 'Mistral Voxtral' : 'OpenAI'
    output.log(colors.cyan(`\nTranscribing with ${providerName}...`))

    let transcriptText: string
    let durationSeconds: number | undefined
    let language: string | undefined

    try {
      if (provider === 'mistral') {
        const result = await this.transcribeWithMistral(audioData, path.basename(transcribeFile), diarize)
        transcriptText = result.text
        durationSeconds = result.durationSeconds
        language = result.language
      } else {
        const result = await this.transcribeWithOpenAI(audioData, path.basename(transcribeFile))
        transcriptText = result.text
        durationSeconds = result.durationSeconds
        language = result.language
      }
    } catch (err) {
      const error = err as Error
      output.error(`Transcription error: ${error.message}`)
      return CommandResult.error(error, 'Failed to transcribe audio')
    }

    if (!transcriptText.trim()) {
      return CommandResult.fail('Transcription returned empty text')
    }

    output.log(colors.green(`\nTranscription complete!`))
    if (durationSeconds) {
      const minutes = Math.floor(durationSeconds / 60)
      const seconds = Math.floor(durationSeconds % 60)
      output.log(colors.gray(`Duration: ${minutes}m ${seconds}s`))
    }
    if (language) {
      output.log(colors.gray(`Language: ${language}`))
    }

    // 5. Build content with frontmatter
    const content = `---
title: ${title}
date: ${new Date().toISOString().slice(0, 10)}
source_file: ${path.basename(inputFile)}
duration_seconds: ${durationSeconds ?? 'unknown'}
language: ${language ?? 'unknown'}
---

${transcriptText}
`

    // 6. Determine output destination
    let finalOutputPath: string | null = null

    if (outputPath) {
      // Explicit output path provided
      finalOutputPath = outputPath
    } else if (save) {
      // Auto-save to source directory with .md extension
      const inputDir = path.dirname(inputFile)
      const inputBasename = path.basename(inputFile, path.extname(inputFile))
      finalOutputPath = path.join(inputDir, `${inputBasename}.md`)
    }

    // 7. Output
    if (finalOutputPath) {
      await writeTextFile(finalOutputPath, content)
      output.log(colors.green(`\nSaved to ${finalOutputPath}`))
    } else {
      // Default: stdout
      output.log('\n' + content)
    }

    // 8. Delete source file if requested
    if (deleteSource) {
      await unlink(inputFile)
      output.log(colors.yellow(`Deleted source: ${inputFile}`))
    }

    return CommandResult.success({
      transcript: transcriptText,
      inputFile,
      outputPath: finalOutputPath,
      durationSeconds,
      language,
    })
  }

  // ---------------------------------------------------------------------------
  // Provider Implementations
  // ---------------------------------------------------------------------------

  private async transcribeWithOpenAI(
    audioData: Uint8Array,
    fileName: string,
  ): Promise<{ text: string; durationSeconds?: number; language?: string }> {
    const client = new OpenAI()
    const audioFile = await toFile(audioData, fileName)

    const result = await client.audio.transcriptions.create({
      file: audioFile,
      model: 'gpt-4o-transcribe',
      response_format: 'json',
    })

    return {
      text: result.text,
      // gpt-4o-transcribe with 'json' format doesn't return duration/language
      durationSeconds: undefined,
      language: undefined,
    }
  }

  private async transcribeWithMistral(
    audioData: Uint8Array,
    fileName: string,
    diarize: boolean,
  ): Promise<{ text: string; durationSeconds?: number; language?: string }> {
    const apiKey = env.get('MISTRAL_API_KEY')
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is not set')
    }

    // Build multipart form data
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audioData).buffer as ArrayBuffer], { type: this.getMimeType(fileName) })
    formData.append('file', blob, fileName)
    formData.append('model', 'voxtral-mini-latest')

    if (diarize) {
      formData.append('diarize', 'true')
    }

    const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Mistral API error (${response.status}): ${errorText}`)
    }

    const result = (await response.json()) as MistralTranscriptionResponse

    // If diarization is enabled, format the text with speaker labels
    let text: string
    if (diarize && result.segments && result.segments.length > 0) {
      text = this.formatDiarizedTranscript(result.segments)
    } else {
      text = result.text
    }

    return {
      text,
      durationSeconds: undefined,
      language: undefined,
    }
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
    }
    return mimeTypes[ext] || 'audio/mpeg'
  }

  private formatDiarizedTranscript(
    segments: Array<{ start: number; end: number; text: string; speaker?: string }>,
  ): string {
    const lines: string[] = []
    let currentSpeaker: string | undefined

    for (const segment of segments) {
      if (segment.speaker && segment.speaker !== currentSpeaker) {
        currentSpeaker = segment.speaker
        lines.push(`\n**${currentSpeaker}:**`)
      }
      lines.push(segment.text.trim())
    }

    return lines.join('\n').trim()
  }
}
