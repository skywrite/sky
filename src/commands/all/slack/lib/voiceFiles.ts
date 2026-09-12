import * as path from 'node:path'
import type { AgentSlackFile } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { slackApiCall } from './slack-api.ts'

export interface SlackCaptureFile extends AgentSlackFile {
  /** Present only after Slack identifies this file as a native voice note. */
  voiceMemo?: { workspaceUrl: string; transcript?: string; vtt?: string }
  /** Prepared before metadata generation; null leaves recognition for the next fetch. */
  voiceTranscript?: string | null
}

interface FileMetadata {
  id?: string
  subtype?: string
  vtt?: string
  transcription?: { status?: string; preview?: { content?: string; has_more?: boolean } }
}

/** Compact CLI output omits voice-note metadata. Look it up only for audio candidates. */
export async function enrichSlackVoiceFiles(
  files: readonly AgentSlackFile[],
  workspaceUrl: string | undefined,
  lookup: (workspace: string, id: string) => Promise<FileMetadata | undefined> = async (workspace, id) =>
    (await slackApiCall(workspace, 'files.info', { file: id }))?.file as FileMetadata | undefined,
): Promise<SlackCaptureFile[]> {
  const metadata = new Map<string, FileMetadata>()
  const result: SlackCaptureFile[] = []
  for (const file of files) {
    const audio =
      file.mimetype?.startsWith('audio/') ||
      (!file.mimetype && /\.(m4a|mp3|mp4|ogg|wav|webm)$/i.test(file.name ?? path.basename(file.path ?? '')))
    if (!audio) {
      result.push(file)
      continue
    }
    if (!workspaceUrl || !file.id)
      throw new Error('Cannot identify a Slack audio attachment without its workspace and file ID.')
    if (!metadata.has(file.id)) {
      const info = await lookup(workspaceUrl, file.id)
      if (!info || info.id !== file.id) throw new Error('Slack audio metadata is unavailable; retry the export.')
      metadata.set(file.id, info)
    }
    const info = metadata.get(file.id)!
    if (info.subtype !== 'slack_audio') {
      result.push(file)
      continue
    }
    const completed = info.transcription?.status === 'complete'
    const preview = info.transcription?.preview
    result.push({
      ...file,
      voiceMemo: {
        workspaceUrl,
        // Slack's preview is usually truncated. Only an explicitly complete one is usable.
        transcript:
          completed && preview?.has_more === false && typeof preview.content === 'string' ? preview.content : undefined,
        vtt: completed && typeof info.vtt === 'string' ? info.vtt : undefined,
      },
    })
  }
  return result
}
