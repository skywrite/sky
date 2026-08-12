import { runCommand } from '#lib/sys/mod.ts'
import ensureFfmpeg, { type FfmpegBinary } from './ensureFfmpeg.ts'

export interface RunFfmpegOptions {
  /**
   * What the call was attempting, used as the first half of the thrown
   * message. Worth passing: the default names only the binary, and "ffmpeg
   * failed" does not say which file or which step.
   */
  describe?: string
}

/**
 * Run one of the ffmpeg binaries, collapsing both ways it can let you down
 * into a thrown Error — the binary not being installed, and the binary running
 * and failing.
 *
 * ffmpeg signals trouble by exit code and explains it on stderr, so a bare
 * `runCommand` leaves every caller writing the same "did it work, and if not
 * what did it say" branch, and leaves each one free to forget the check.
 * Errors here reach someone at a terminal, so the message leads with the
 * caller's `describe` and falls back to the exit code only when ffmpeg said
 * nothing at all.
 *
 * Sets the log level itself so the message stays readable — see below.
 *
 * Returns stdout, which is where ffprobe reports; ffmpeg proper normally
 * writes nothing there.
 */
export default async function runFfmpeg(
  binary: FfmpegBinary,
  args: string[],
  options: RunFfmpegOptions = {},
): Promise<string> {
  await ensureFfmpeg(binary)

  // Both binaries open stderr with a version-and-build-configuration banner and
  // narrate their progress there, all of which would land verbatim in the
  // message thrown below. Quieting them here rather than in each caller is what
  // stops one forgotten flag from turning a one-line failure into fifteen. Both
  // options are last-wins, so a caller that wants the detail can pass its own
  // `-v` after these.
  const result = await runCommand(binary, ['-hide_banner', '-v', 'error', ...args])

  if (!result.success) {
    throw new Error(`${options.describe ?? `${binary} failed`}: ${result.stderr.trim() || `exited ${result.code}`}`)
  }

  return result.stdout
}
