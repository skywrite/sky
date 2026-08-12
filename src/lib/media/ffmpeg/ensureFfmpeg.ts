import { isCommandAvailable } from '#lib/sys/mod.ts'

export type FfmpegBinary = 'ffmpeg' | 'ffprobe'

/**
 * Guard a call on the ffmpeg suite being installed, so a missing binary fails
 * with an actionable message rather than an opaque spawn error.
 *
 * The check is per-binary even though both ship in the same Homebrew formula:
 * a PATH can carry one without the other, and naming the one that is missing
 * is what makes the failure fixable.
 *
 * Exported so a command can fail up front instead of partway through a
 * pipeline that has already transcribed or written something.
 */
export default async function ensureFfmpeg(binary: FfmpegBinary = 'ffmpeg'): Promise<void> {
  if (await isCommandAvailable(binary)) return

  throw new Error(`${binary} is required but was not found on your PATH. Install it with: brew install ffmpeg`)
}
