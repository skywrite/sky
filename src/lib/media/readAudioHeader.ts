import { open } from 'node:fs/promises'
import { AUDIO_HEADER_BYTES } from './audioHeader.ts'

export async function readAudioHeader(file: string): Promise<Uint8Array> {
  const handle = await open(file, 'r')
  try {
    const bytes = new Uint8Array(AUDIO_HEADER_BYTES)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return bytes.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
