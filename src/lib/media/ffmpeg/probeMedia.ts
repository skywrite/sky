import runFfmpeg from './runFfmpeg.ts'

export interface MediaInfo {
  /** Playing length in seconds, or null for a container that records none. */
  durationSeconds: number | null
  hasAudio: boolean
  hasVideo: boolean
  /**
   * The container's `creation_time` tag, verbatim — usually ISO-8601 in UTC.
   * Deliberately left a string: only the caller knows which timezone the
   * recording should be read in, and most recorders omit the tag entirely.
   */
  creationTime: string | null
}

interface FfprobeJson {
  format?: { duration?: string; tags?: { creation_time?: string } }
  streams?: { codec_type?: string }[]
}

/**
 * Report what a media file contains, without decoding it.
 *
 * One ffprobe call answers the questions worth asking before spending real
 * time on a recording:
 *
 * - How long is it — a file's mtime is when recording *stopped*, so the time
 *   it started is mtime minus this.
 * - Does it actually carry an audio track — a screen recording made with the
 *   mic off transcribes to nothing, and this catches that before an upload
 *   and a paid API call rather than after.
 * - Does it carry video — audio-only input needs no demux step.
 *
 * Throws when ffprobe cannot read the file at all: a path that is not there,
 * or a container it does not understand.
 */
export default async function probeMedia(filePath: string): Promise<MediaInfo> {
  const stdout = await runFfmpeg(
    'ffprobe',
    ['-show_entries', 'format=duration:format_tags=creation_time:stream=codec_type', '-of', 'json', filePath],
    { describe: `ffprobe could not read ${filePath}` },
  )

  let probe: FfprobeJson
  try {
    probe = JSON.parse(stdout) as FfprobeJson
  } catch {
    throw new Error(`ffprobe returned output that is not JSON for ${filePath}`)
  }

  const streams = probe.streams ?? []
  const duration = Number.parseFloat(probe.format?.duration ?? '')

  return {
    durationSeconds: Number.isFinite(duration) ? duration : null,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    hasVideo: streams.some((stream) => stream.codec_type === 'video'),
    creationTime: probe.format?.tags?.creation_time ?? null,
  }
}
