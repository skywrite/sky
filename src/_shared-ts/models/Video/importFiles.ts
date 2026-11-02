const video = /\.(?:mp4|mov|m4v|webm|mkv)$/i
const transcript = /\.(?:srt|vtt|txt)$/i
const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()
const loom = (name: string) => name.match(/-([a-f\d]{32})\.[^.]+$/i)?.[1].toLowerCase()

/** A recording and its sidecar are one input; conflicting provider IDs must never be paired. */
export function videoTranscriptPair<T extends { name: string }>(files: T[]): [T, T] | null {
  if (files.length !== 2) return null
  const recording = files.find((file) => video.test(file.name))
  const text = files.find((file) => transcript.test(file.name))
  if (!recording || !text) return null
  const a = loom(recording.name),
    b = loom(text.name)
  return a && b && a !== b ? null : [text, recording]
}

/** Preserve selection order, grouping only an unambiguous matching sidecar or an explicitly selected pair. */
export function groupVideoFiles<T extends { name: string }>(files: T[]): T[][] {
  const explicit = videoTranscriptPair(files)
  if (explicit) return [explicit]
  const used = new Set<T>()
  const groups: T[][] = []
  for (const file of files) {
    if (used.has(file)) continue
    const alternatives = files.filter(
      (other) =>
        other !== file &&
        !used.has(other) &&
        videoTranscriptPair([file, other]) &&
        (stem(file.name) === stem(other.name) || Boolean(loom(file.name) && loom(file.name) === loom(other.name))),
    )
    if (alternatives.length === 1) {
      const other = alternatives[0]
      const competing = files.filter(
        (candidate) =>
          candidate !== other &&
          !used.has(candidate) &&
          videoTranscriptPair([candidate, other]) &&
          (stem(candidate.name) === stem(other.name) ||
            Boolean(loom(candidate.name) && loom(candidate.name) === loom(other.name))),
      )
      if (competing.length === 1) {
        groups.push(videoTranscriptPair([file, other])!)
        used.add(file)
        used.add(other)
        continue
      }
    }
    used.add(file)
    groups.push([file])
  }
  return groups
}
