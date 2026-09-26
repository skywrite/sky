import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import type { AudioTranscriptionOptions } from './audio.ts'
import type { Transcription } from './transcribe.ts'

interface MistralTranscriptionResponse {
  text: string
  segments?: Array<{ text: string; speaker?: string | null }>
}

export async function transcribeWithMistral(
  audioData: Uint8Array,
  fileName: string,
  options: AudioTranscriptionOptions = {},
): Promise<Transcription> {
  const apiKey = env.get('MISTRAL_API_KEY')
  if (!apiKey) throw new Error('MISTRAL_API_KEY environment variable is not set')
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
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioData).buffer as ArrayBuffer], {
    type: mimeTypes[path.extname(fileName).toLowerCase()] ?? 'audio/mpeg',
  })
  formData.append('file', blob, fileName)
  formData.append('model', 'voxtral-mini-latest')
  if (options.diarize) formData.append('diarize', 'true')
  const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`Mistral API error (${response.status}): ${await response.text()}`)
  const result = (await response.json()) as MistralTranscriptionResponse
  if (!options.diarize || !result.segments?.length) return { text: result.text }
  const lines: string[] = []
  let speaker: string | undefined
  for (const segment of result.segments) {
    if (segment.speaker && segment.speaker !== speaker) {
      speaker = segment.speaker
      lines.push(`\n**${speaker}:**`)
    }
    lines.push(segment.text.trim())
  }
  return { text: lines.join('\n').trim() }
}
