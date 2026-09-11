import { parentPort, workerData } from 'node:worker_threads'
import { loadResumeSession, type LoadResumeOptions } from '#shared/models/Chat/ChatStore/mod.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'

const { filePath, options, speaker } = workerData as { filePath: string; options: LoadResumeOptions; speaker: string }
setUserSpeakerLabel(speaker)
parentPort!.postMessage(await loadResumeSession(filePath, options))
