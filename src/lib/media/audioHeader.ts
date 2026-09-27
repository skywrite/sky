export const AUDIO_HEADER_BYTES = 64

export type AudioContainer = 'caf' | 'mp4' | 'wav' | 'flac' | 'ogg' | 'webm' | 'mp3' | 'aac'

/** A bounded, browser-safe routing hint. The server probes the complete file before using its audio. */
export function audioContainerFromHeader(bytes: Uint8Array): AudioContainer | null {
  const matches = (text: string, offset = 0) =>
    bytes.length >= offset + text.length && [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0))
  if (bytes.length >= 8 && matches('caff') && bytes[4] === 0 && bytes[5] === 1) return 'caf'
  if (matches('RIFF') && matches('WAVE', 8)) return 'wav'
  if (matches('fLaC')) return 'flac'
  if (matches('OggS\0')) return 'ogg'
  if (matches('ID3') && bytes.length >= 10) return 'mp3'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'webm'
  if (
    matches('ftyp', 4) &&
    ['M4A ', 'M4B ', 'mp41', 'mp42', 'isom', 'iso2', 'iso5', 'iso6', 'avc1', 'dash'].some((brand) => matches(brand, 8))
  )
    return 'mp4'
  if (bytes.length >= 4 && bytes[0] === 0xff) {
    if ((bytes[1] & 0xf6) === 0xf0 && (bytes[2] & 0x3c) !== 0x3c) return 'aac'
    if (
      (bytes[1] & 0xe0) === 0xe0 &&
      (bytes[1] & 0x18) !== 0x08 &&
      (bytes[1] & 0x06) !== 0 &&
      (bytes[2] & 0xf0) !== 0xf0 &&
      (bytes[2] & 0x0c) !== 0x0c
    )
      return 'mp3'
  }
  return null
}

const inspected = new WeakMap<Blob, Promise<AudioContainer | null>>()

export function inspectAudioBlob(file: Blob): Promise<AudioContainer | null> {
  let result = inspected.get(file)
  if (!result) {
    result = file
      .slice(0, AUDIO_HEADER_BYTES)
      .arrayBuffer()
      .then((bytes) => audioContainerFromHeader(new Uint8Array(bytes)))
    inspected.set(file, result)
  }
  return result
}
