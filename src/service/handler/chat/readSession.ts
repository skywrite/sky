import type { LoadResumeOptions, ResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { userSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { runWorker } from '#shared/sys/worker.ts'

/** Recovery parses arbitrary Markdown and provider history; keep it off the HTTP event loop. */
export function readSession(filePath: string, options: LoadResumeOptions = {}): Promise<ResumeSession> {
  return runWorker(new URL('./readSessionWorker.ts', import.meta.url), {
    data: { filePath, options, speaker: userSpeakerLabel() },
    timeoutMs: 10_000,
  })
}
