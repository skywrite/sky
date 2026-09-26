import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { transcribeAudio } from '#commands/all/audio/transcript/lib/audio.ts'
import { glossaryKeywords, loadGlossary } from '#commands/all/audio/transcript/lib/glossary.ts'
import {
  clearTranscriptRun,
  TranscriptRun,
  type TranscriptRunOptions,
  type RawStage,
} from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import ZoomVTT from '#commands/all/audio/transcript/lib/ZoomVTT/mod.ts'
import fetchNowSync from '#shared/nbfs/fetchNowSync.ts'
import type { SlackCaptureMessage } from './captureMessages.ts'
import { getSlackCredentials } from './slack-api.ts'
import type { SlackCaptureFile } from './voiceFiles.ts'

export function slackVttText(vtt: string): string | undefined {
  if (!ZoomVTT.isVtt(vtt)) return undefined
  // The Zoom parser recognizes colon prefixes as speakers. In a single-speaker
  // voice note those are spoken words, so keep them in the transcript.
  return (
    ZoomVTT.parse(vtt)
      .cues.map((cue) => `${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text}`)
      .join(' ')
      .trim() || undefined
  )
}

async function nativeTranscript(
  memo: NonNullable<SlackCaptureFile['voiceMemo']>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (memo.transcript?.trim()) return memo.transcript.trim()
  if (!memo.vtt) return undefined
  try {
    const url = new URL(memo.vtt)
    if (url.protocol !== 'https:' || url.hostname !== 'files.slack.com') return undefined
    const credentials = await getSlackCredentials(memo.workspaceUrl)
    if (!credentials) return undefined
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        Cookie: `d=${encodeURIComponent(credentials.cookie)}`,
        Referer: 'https://app.slack.com/',
      },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return undefined
    return slackVttText(await response.text())
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

export interface VoiceTranscriptionOptions {
  signal?: AbortSignal
  /** Cleared by the caller only after the conversation has been saved. */
  runs?: Set<string>
  runOptions?: TranscriptRunOptions
  recognize?: (data: Uint8Array, name: string, signal?: AbortSignal) => Promise<RawStage>
  native?: typeof nativeTranscript
}

/** Prefer Slack's full transcript, then reuse the audio pipeline's durable recognition checkpoint. */
export async function transcribeSlackVoiceMemo(
  file: SlackCaptureFile,
  originalPath: string,
  options: VoiceTranscriptionOptions = {},
): Promise<string> {
  if (!file.voiceMemo) throw new Error('Only Slack voice notes are transcribed automatically.')
  options.signal?.throwIfAborted()
  const native = await (options.native ?? nativeTranscript)(file.voiceMemo, options.signal)
  if (native?.trim()) return native.trim()
  const run = await TranscriptRun.forFile(
    originalPath,
    options.runOptions ?? { now: () => fetchNowSync().plainDateTime.toString() },
  )
  options.runs?.add(run.key)
  const cached = await run.get('raw')
  if (typeof cached?.data.text === 'string' && cached.data.text.trim()) return cached.data.text.trim()
  const recognize =
    options.recognize ??
    (async (data, name, signal) => {
      const glossary = await loadGlossary()
      return transcribeAudio(data, name, { keywords: glossary ? glossaryKeywords(glossary) : [], signal })
    })
  const result = await recognize(await readFile(originalPath), path.basename(originalPath), options.signal)
  if (!result.text.trim()) throw new Error('Voice memo transcription returned no words.')
  await run.put('raw', result)
  return result.text.trim()
}

/** Prepare speech before choosing the title/slug; pass the same results to the capture writer. */
export async function prepareSlackVoiceTranscripts(
  messages: readonly SlackCaptureMessage[],
  options: VoiceTranscriptionOptions & {
    output: { log: (message: string) => void }
    transcribe?: typeof transcribeSlackVoiceMemo
  },
): Promise<SlackCaptureMessage[]> {
  const transcripts = new Map<string, string | null>()
  const prepared: SlackCaptureMessage[] = []
  for (const message of messages) {
    options.signal?.throwIfAborted()
    const files: SlackCaptureFile[] = []
    for (const file of message.files ?? []) {
      if (!file.voiceMemo || file.voiceTranscript !== undefined) {
        files.push(file)
        continue
      }
      const key = `${file.voiceMemo.workspaceUrl}/${file.id ?? file.path}`
      if (!transcripts.has(key)) {
        try {
          if (file.error || !file.path) throw new Error(file.error || 'Original file unavailable')
          const text = await (options.transcribe ?? transcribeSlackVoiceMemo)(file, file.path, options)
          transcripts.set(key, text)
        } catch (error) {
          options.signal?.throwIfAborted()
          options.output.log(
            `  Voice memo transcript pending: ${file.name ?? file.id} (${error instanceof Error ? error.message : String(error)})`,
          )
          transcripts.set(key, null)
        }
      }
      files.push({ ...file, voiceTranscript: transcripts.get(key)! })
    }
    prepared.push({ ...message, ...(message.files ? { files } : {}) })
  }
  return prepared
}

export async function clearSavedVoiceTranscripts(
  runs: ReadonlySet<string>,
  output: { log: (message: string) => void },
): Promise<void> {
  for (const key of runs) {
    try {
      await clearTranscriptRun(key)
    } catch {
      output.log('  Could not clear a saved voice transcript checkpoint; it will expire automatically.')
    }
  }
}
