import * as path from 'node:path'
import type { AgentSlackFile } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { slackSourceUrl } from '#shared/models/Message/slack/files.ts'
import { slackApiCall } from './slack-api.ts'

export interface SlackCaptureFile extends AgentSlackFile {
  /** Provider-confirmed remote documents are preserved as links, not downloaded HTML. */
  externalUrl?: string
  sourceUrl?: string
  /** Present only after Slack identifies this file as a native voice note. */
  voiceMemo?: { workspaceUrl: string; transcript?: string; vtt?: string }
  /** Prepared before metadata generation; null leaves recognition for the next fetch. */
  voiceTranscript?: string | null
}

interface FileMetadata {
  id?: string
  mode?: string
  is_external?: boolean
  external_url?: string
  url_private?: string
  permalink?: string
  subtype?: string
  vtt?: string
  transcription?: { status?: string; preview?: { content?: string; has_more?: boolean } }
}

/** Compact CLI output omits remote URLs and voice-note metadata. */
export async function enrichSlackFiles(
  files: readonly AgentSlackFile[],
  workspaceUrl: string | undefined,
  lookup: (workspace: string, id: string) => Promise<FileMetadata | undefined> = async (workspace, id) =>
    (await slackApiCall(workspace, 'files.info', { file: id }))?.file as FileMetadata | undefined,
): Promise<SlackCaptureFile[]> {
  const metadata = new Map<string, FileMetadata | undefined>()
  const result: SlackCaptureFile[] = []
  for (const file of files) {
    const audio =
      file.mimetype?.startsWith('audio/') ||
      (!file.mimetype && /\.(m4a|mp3|mp4|ogg|wav|webm)$/i.test(file.name ?? path.basename(file.path ?? '')))
    if (!audio && file.mode !== 'external' && !file.error && (!file.id || !metadata.has(file.id))) {
      result.push(file)
      continue
    }
    if (!workspaceUrl || !file.id) {
      if (audio && !file.error)
        throw new Error('Cannot identify a Slack audio attachment without its workspace and file ID.')
      result.push(file)
      continue
    }
    if (!metadata.has(file.id)) {
      const info = await lookup(workspaceUrl, file.id).catch(() => undefined)
      metadata.set(file.id, info?.id === file.id ? info : undefined)
    }
    const info = metadata.get(file.id)
    if (!info) {
      if (audio && !file.error) throw new Error('Slack audio metadata is unavailable; retry the export.')
      result.push(file)
      continue
    }
    const external = file.mode === 'external' || info.mode === 'external' || info.is_external === true
    const enriched: SlackCaptureFile = {
      ...file,
      ...(external
        ? {
            mode: 'external',
            externalUrl:
              slackSourceUrl(info.external_url) ?? slackSourceUrl(info.url_private) ?? slackSourceUrl(info.permalink),
          }
        : {}),
      sourceUrl: slackSourceUrl(info.permalink),
    }
    if (external || info.subtype !== 'slack_audio') {
      result.push(enriched)
      continue
    }
    const completed = info.transcription?.status === 'complete'
    const preview = info.transcription?.preview
    result.push({
      ...enriched,
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
