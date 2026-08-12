import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import runFfmpeg from './runFfmpeg.ts'

export interface ExtractAudioOptions {
  /** Where to write. Defaults to an `.m4a` inside a fresh temp directory. */
  outputPath?: string
  sampleRateHz?: number
  channels?: number
  bitrateKbps?: number
}

/**
 * Strip a recording down to a speech-sized audio track, returning the path written.
 *
 * The defaults are tuned for transcription rather than listening. Speech
 * models resample to 16 kHz mono internally, so a higher rate or a second
 * channel is bytes on the wire that cannot improve the transcript. At 32 kbps
 * an hour of talking lands near 15 MB, which keeps a long recording inside the
 * 25 MB upload limit the transcription endpoints enforce — at 64 kbps it would
 * cross that before the hour was out.
 *
 * Audio-only input is fine too (`-vn` is a no-op there), so this doubles as the
 * "convert to something the API accepts" step for containers like `.caf`.
 *
 * The caller owns the file that comes back, including removing the temp
 * directory it defaults into.
 */
export default async function extractAudio(inputPath: string, options: ExtractAudioOptions = {}): Promise<string> {
  const { sampleRateHz = 16_000, channels = 1, bitrateKbps = 32 } = options

  const outputPath =
    options.outputPath ??
    path.join(
      await makeTempDir({ prefix: 'sky-extract-audio-' }),
      `${path.basename(inputPath, path.extname(inputPath))}.m4a`,
    )

  // Paired per flag so each one can be read with its value; ffmpeg itself takes them flat.
  await runFfmpeg(
    'ffmpeg',
    [
      ['-y'], // overwrite outputPath if it exists — nothing here can answer a confirmation prompt
      ['-i', inputPath], // the source; flags before it configure reading, flags after it configure writing
      ['-vn'], // "video: none" — drop the video stream instead of re-encoding it
      ['-ac', String(channels)], // audio channels, downmixing to mono at 1
      ['-ar', String(sampleRateHz)], // audio rate: resample to this many samples per second
      ['-c:a', 'aac'], // audio codec; AAC is what an .m4a container expects
      ['-b:a', `${bitrateKbps}k`], // audio bitrate in kbit/s — the size dial the doc comment above works out
      [outputPath], // positional, and ffmpeg requires it last
    ].flat(),
    { describe: `ffmpeg could not extract audio from ${inputPath}` },
  )

  return outputPath
}
