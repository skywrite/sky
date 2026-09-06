import { readFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { isStepCount, streamText } from 'ai'
import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  AccountResolutionError,
  GoogleApiError,
  deleteFile,
  getFile,
  importFileAsDoc,
  listAccountEmails,
  resolveFileRef,
  slideDesignPromptSection,
  workspaceKind,
} from '#lib/google/mod.ts'
import type { DriveFile } from '#lib/google/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { getProfile, type ModelProfile, resolveProfile } from '#shared/ai/models.ts'
import { cachedInstructions, cacheTailStep } from '#shared/ai/promptCache.ts'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import { turnErrorMessage } from '#shared/models/Chat/ChatEngine/turnErrorMessage.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { thrownOutcome, TimingSpan } from '#shared/timing/mod.ts'
import { timingSummary } from '#shared/timing/summary.ts'
import { probeAccountsForFile } from '../lib/probeAccounts.ts'
import { resolveGoogleClient } from '../lib/resolveClient.ts'
import { withReadTarget, writeDocArtifact } from './lib/artifact.ts'
import { IMPORT_EXTENSIONS, MAX_IMPORT_BYTES, resolveImportSource } from './lib/importFile.ts'
import { formatTiming, type MissionTiming } from './lib/timing.ts'
import { createAgentTools, createMissionState } from './lib/tools.ts'
import type { MissionFile } from './lib/tools.ts'

const MAX_STEPS = 48

/** The profile a mission runs on unless `--reasoning` says otherwise (Qwen on Cerebras, on trial). */
const MISSION_PROFILE = 'default-cerebras-qwen-3.8'
/**
 * The watchdog counts EVERY stream frame: includeRawChunks surfaces the
 * provider's raw SSE events, so Anthropic's keep-alive pings re-arm it even
 * while the model thinks silently for minutes (deep thinking streams no
 * visible parts, but pings keep flowing). A stretch this long without even a
 * ping means the transport died beyond what the provider's own idle guard
 * (90s × 3 tries) could recover. Abort and report what completed instead of
 * spinning forever.
 */
const STREAM_STALL_MS = 360_000
/** A visibly quiet stream gets a progress line at each multiple of this. */
const HEARTBEAT_MS = 120_000
const MAX_DATA_CHARS = 262_144
const MAX_MISSION_IMAGES = 24
const IMAGE_EXT_RE = /\.(png|jpe?g|gif)$/i

const params = {
  mission: ArgOrFlag.string('What to create or change, with ALL content the document needs', {
    short: 'm',
    required: true,
  }),
  file: Flag.string('Target an existing document (Google URL or file id)', { short: 'f' }),
  import: Flag.string(
    'Local document (.pdf, .docx, .md, .txt) uploaded converted to a Google Doc — the new Doc becomes the mission target',
  ),
  data: Flag.string('Path to a local CSV/text file appended to the mission as data', { short: 'd' }),
  images: Flag.string('Directory of images offered to the mission (backgrounds, logos)', { short: 'i' }),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  reasoning: Flag.string('Model profile that runs the mission (e.g. default-cerebras-qwen-3.8, default-opus-5)', {
    short: 'r',
    default: () => MISSION_PROFILE,
  }),
  noOpen: Flag.bool('Do not open touched files in the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; files: MissionFile[]; steps: number; artifact?: string; timing: MissionTiming }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:agent': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class GoogleAgentTask extends Command {
  static override description: CommandDescription = {
    name: 'google:agent',
    description:
      'Create or modify Google Docs, Slides and Sheets from a natural-language mission. Include all needed content in the mission itself.',
    descriptionLong: [
      'Runs a focused sub-agent that executes one Google Workspace mission end',
      'to end: find/read files, import local documents (PDF, docx) as Docs,',
      'create docs from markdown (visually reviewed as rendered PDF pages),',
      'build styled decks slide by slide with visual verification via',
      'rendered thumbnails, place local images into docs and decks,',
      'read/leave/reply-to comments, suggest tracked edits in Docs, and build',
      'spreadsheets with live formulas, styling and native charts embeddable',
      'into decks as linked charts. Progress streams as it works; touched',
      `files are recorded in the notebook under ${actionKindRel('doc')}/.`,
    ],
    usage: [
      'sky google:agent "Create a doc titled Atlas Q3 Plan with: ..."',
      'sky google:agent "Build a 6-slide deck pitching Atlas: ..."',
      'sky google:agent "Make a budget sheet with a column chart" -d spend.csv',
      'sky google:agent "Photo-background deck pitching Atlas, dark and moody" -i ~/decks/backgrounds',
      'sky google:agent "Tighten the Outlook section" -f <doc-url>',
      'sky google:agent "Review this contract; leave anchored comments on risky clauses" --import ~/deals/atlas-msa.pdf',
      'sky google:agent "Suggest edits fixing passive voice" -f <doc-url>',
      'sky google:agent "..." -a work',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    output.log(`  Mission: ${String(input.mission ?? '')}`)
    if (input.file) output.log(`  Target:  ${String(input.file)}`)
    if (input.import) output.log(`  Import:  ${String(input.import)}`)
    output.log(`  Account: ${input.account ? String(input.account) : '(default)'}`)
  }

  /** Missions targeting the same file can be session-approved once; create missions always prompt. */
  static approvalSessionKey(input: Record<string, unknown>): string | undefined {
    if (typeof input.file !== 'string') return undefined
    return resolveFileRef(input.file)?.fileId
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    // The mission's model is a profile, picked per run. The default is the
    // fast Cerebras profile while it is on trial for missions;
    // `--reasoning default-opus-5` is the deep run. An unknown name fails
    // here, before any Google work.
    let missionProfile: ModelProfile
    try {
      missionProfile = getProfile(args.reasoning)
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }
    const { mission, file, account, import: importPath } = args

    if (!mission?.trim()) {
      return CommandResult.fail('Provide a mission, e.g. sky google:agent "Create a doc titled X with ..."')
    }

    let client
    try {
      client = await resolveGoogleClient({
        secrets,
        requested: account,
        interactive: context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    // Google live-renders remote edits, so an open tab is the mission's
    // preview pane. One tab per file, capped — never a tab storm.
    const openedUrls = new Set<string>()
    const openInBrowser = (url: string | undefined) => {
      if (!url || args.noOpen || openedUrls.has(url) || openedUrls.size >= 3) return
      openedUrls.add(url)
      open(url).catch(() => undefined)
    }

    if (file && importPath) {
      return CommandResult.fail('Pass either --file (existing Google file) or --import (local document), not both.')
    }

    let target: { fileId: string; kind?: string; tabId?: string } | null = null
    let targetFile: DriveFile | undefined
    if (file) {
      target = resolveFileRef(file)
      if (!target) return CommandResult.fail(`--file is not a Google file URL or id: ${file}`)

      // Preflight the target before spinning up the agent. Drive answers 404
      // both for "gone" and "wrong account" — on miss, probe the other stored
      // accounts so the error names the account that can actually see it.
      try {
        targetFile = await getFile(client, target.fileId)
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 404) {
          const others = (await listAccountEmails(secrets)).filter((email) => email !== client.email)
          const visibleTo = await probeAccountsForFile(secrets, others, target.fileId)
          return CommandResult.fail(
            visibleTo.length > 0
              ? `The target file is not visible to ${client.email}, but ${visibleTo.join(' and ')} can see it. Rerun with -a ${visibleTo[0]}`
              : `Target file not found for ${client.email}: ${target.fileId}. Check the URL — or connect the account that owns it (sky google:auth).`,
          )
        }
        throw err
      }
    }

    let importedFrom: string | undefined
    if (importPath) {
      const source = resolveImportSource(importPath)
      if (!source) {
        return CommandResult.fail(`--import handles ${IMPORT_EXTENSIONS} files, got: ${importPath}`)
      }
      let data: Uint8Array
      try {
        data = new Uint8Array(await readFile(source.filePath))
      } catch {
        return CommandResult.fail(`Could not read --import file: ${importPath}`)
      }
      if (data.length > MAX_IMPORT_BYTES) {
        const mb = (n: number) => Math.round(n / (1024 * 1024))
        return CommandResult.fail(
          `--import file is too large for Doc conversion (${mb(data.length)}MB > ${mb(MAX_IMPORT_BYTES)}MB)`,
        )
      }
      importedFrom = path.basename(source.filePath)
      try {
        targetFile = await importFileAsDoc(client, { title: source.title, data, contentType: source.contentType })
      } catch (err) {
        if (err instanceof GoogleApiError) {
          return CommandResult.fail(`Drive could not convert ${importedFrom} to a Google Doc: ${err.message}`)
        }
        throw err
      }
      target = { fileId: targetFile.id }
      output.log(colors.dim(`◦ Imported ${importedFrom} as Google Doc "${targetFile.name}"`))
    }

    let missionData: string | undefined
    if (args.data) {
      try {
        missionData = await readTextFile(args.data)
      } catch {
        return CommandResult.fail(`Could not read --data file: ${args.data}`)
      }
      if (missionData.length > MAX_DATA_CHARS) {
        return CommandResult.fail(`--data file is too large (${missionData.length} chars > ${MAX_DATA_CHARS})`)
      }
    }

    let imagePaths: string[] = []
    if (args.images) {
      const dir = args.images.startsWith('~/') ? path.join(os.homedir(), args.images.slice(2)) : args.images
      try {
        for await (const entry of readDir(dir)) {
          if (entry.isFile && IMAGE_EXT_RE.test(entry.name)) imagePaths.push(path.join(dir, entry.name))
        }
      } catch {
        return CommandResult.fail(`Could not read --images directory: ${args.images}`)
      }
      if (imagePaths.length === 0) {
        return CommandResult.fail(`No PNG/JPEG/GIF files in --images directory: ${args.images}`)
      }
      imagePaths.sort()
      imagePaths = imagePaths.slice(0, MAX_MISSION_IMAGES)
    }

    if (!import.meta.dirname) return CommandResult.error('Cannot locate the agent prompt directory')
    const promptDir = path.join(import.meta.dirname, 'prompts')
    const systemPrompt = await readPromptFile(path.join(promptDir, 'agent.prompt.md'))
    const critiquePrompt = await readPromptFile(path.join(promptDir, 'slide-critique.prompt.md'))
    const deckCritiquePrompt = await readPromptFile(path.join(promptDir, 'deck-critique.prompt.md'))
    const docCritiquePrompt = await readPromptFile(path.join(promptDir, 'doc-critique.prompt.md'))

    const state = createMissionState()
    state.onFileTracked = (missionFile) => openInBrowser(missionFile.url)
    if (targetFile) openInBrowser(targetFile.webViewLink)
    // The imported Doc is a mission artifact even when the agent only reads it.
    if (importedFrom && target && targetFile) {
      state.files.push({
        id: target.fileId,
        title: targetFile.name,
        url: targetFile.webViewLink,
        kind: 'doc',
        action: 'created',
      })
    }
    const log = (line: string) => output.log(colors.dim(`◦ ${line}`))
    const tools = createAgentTools({ client, log, state, critiquePrompt, deckCritiquePrompt, docCritiquePrompt })

    const missionMessage = [
      `Mission: ${mission.trim()}`,
      target && targetFile
        ? `Target file id: ${target.fileId} — "${targetFile.name}" (${workspaceKind(targetFile.mimeType) ?? targetFile.mimeType})${target.tabId ? ` — the link names tab ${target.tabId}: the mission concerns that tab (pass this tabId to doc tools)` : ''}${importedFrom ? ` — just created by converting the local file ${importedFrom}; the mission concerns this Doc` : ''}`
        : undefined,
      missionData ? `Data (pass verbatim to set_values via its csv parameter):\n\n${missionData.trim()}` : undefined,
      imagePaths.length > 0
        ? `Images available on disk (stage with upload_image using these exact paths):\n${imagePaths.join('\n')}`
        : undefined,
      `Google account in use: ${client.email}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    log(`Mission started (${client.email} · ${args.reasoning})`)

    const abort = new AbortController()
    const missionSpan = new TimingSpan({ kind: 'generation', name: 'google:mission' })
    try {
      // Streamed for the same reason as ai:chat: long generations hold the
      // socket past Anthropic's non-streaming ceiling on flaky networks.
      const stream = missionSpan.run(() =>
        streamText({
          // A mission is expensive to lose — ride out 429/529 bursts with more
          // patience than the SDK's default 2 retries.
          ...resolveProfile(missionProfile, { maxRetries: 4 }),
          instructions: cachedInstructions([systemPrompt, slideDesignPromptSection()]),
          messages: [{ role: 'user', content: missionMessage }],
          tools,
          stopWhen: isStepCount(MAX_STEPS),
          // A mission replays its whole history on every step; moving the cache
          // breakpoint to the step's last message makes that replay a cache read.
          prepareStep: cacheTailStep,
          abortSignal: abort.signal,
          // Raw SSE frames (pings included) feed the stall watchdog, so a long
          // silent think is not mistaken for a dead stream.
          includeRawChunks: true,
        }),
      )
      let stalled = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => {
          stalled = true
          abort.abort()
        }, STREAM_STALL_MS)
      }
      let report = ''
      let steps = 0
      let finishedSteps = 0
      // The SDK delivers a failed request as an `error` part and then throws a
      // generic "no output" from the text promise; the part is the real reason.
      let modelError: string | undefined
      let lastEvent = 'none'
      let rawSinceVisible = 0
      let lastVisibleAt = Date.now()
      let heartbeatsLogged = 0
      // Deep thinking streams nothing visible for minutes — show life so a
      // long think does not read as a hang.
      const heartbeat = setInterval(() => {
        const quietMs = Date.now() - lastVisibleAt
        const bucket = Math.floor(quietMs / HEARTBEAT_MS)
        if (bucket <= 0) {
          heartbeatsLogged = 0
        } else if (bucket > heartbeatsLogged) {
          heartbeatsLogged = bucket
          log(`Still working — model thinking (${Math.round(quietMs / 60_000)}m quiet)`)
        }
      }, 30_000)
      try {
        arm()
        for await (const part of stream.fullStream) {
          arm()
          // Raw frames (SSE pings and friends) prove the transport is alive;
          // they re-arm the watchdog but are not mission progress.
          if (part.type === 'raw') {
            rawSinceVisible++
            continue
          }
          rawSinceVisible = 0
          lastVisibleAt = Date.now()
          lastEvent = part.type
          if (part.type === 'finish-step') finishedSteps++
          if (part.type === 'error') {
            modelError = turnErrorMessage(part.error)
            log(`Model error: ${modelError}`)
            await logAIError({ source: 'google:agent', stage: 'model-error', message: modelError })
          }
        }
        report = (await stream.text).trim()
        steps = (await stream.steps).length
      } catch (err) {
        if (!stalled) throw modelError ? new Error(`The model request failed: ${modelError}`) : err
        log(`No stream activity for ${STREAM_STALL_MS / 60_000} minutes — mission aborted as stalled`)
        await logAIError({
          source: 'google:agent',
          stage: 'stream-stall',
          message: `no stream activity for ${STREAM_STALL_MS / 60_000} minutes — mission aborted after ${finishedSteps} completed step(s); last visible event: ${lastEvent}; raw frames after it: ${rawSinceVisible}`,
        })
      } finally {
        clearTimeout(watchdog)
        clearInterval(heartbeat)
      }
      // A mission that hits the step cap (or stalls) ends with no final
      // text — the user must still get every file and URL it touched.
      if (!report) {
        const touched = state.files.map(
          (f) => `${f.action === 'created' ? 'Created' : 'Updated'}: ${f.title}${f.url ? ` — ${f.url}` : ''}`,
        )
        report = [
          stalled
            ? `The mission stalled (no stream activity for ${STREAM_STALL_MS / 60_000} minutes) and was aborted. Files touched before the stall:`
            : `The mission ended after ${steps} steps without a final report${steps >= MAX_STEPS ? ' (step limit reached)' : ''}. Files touched:`,
          ...(touched.length > 0 ? touched : ['(none)']),
        ].join('\n')
      }

      // The mission's last word on itself: what ran, how long, where the time went.
      missionSpan.finish(stalled ? 'aborted' : modelError ? 'error' : 'success')
      const timing: MissionTiming = { ...timingSummary(missionSpan), profile: args.reasoning, steps }
      log(formatTiming(timing))

      let artifact: string | undefined
      if (state.files.length > 0) {
        try {
          const now = context.notebookNow
          artifact = await writeDocArtifact(
            { date: now.date, time: now.time },
            { account: client.email, mission: mission.trim(), files: state.files, report, timing },
          )
          log(`Recorded in notebook: ${artifact}`)
        } catch (err) {
          output.log(colors.dim(`◦ Could not write the notebook record: ${(err as Error).message}`))
        }
      }

      output.log('')
      output.log(report.trim())
      // Read-only missions report the target too: a caller (ai:chat) records
      // the files a mission concerned, not just the ones it edited.
      const readTarget =
        target && targetFile
          ? {
              id: target.fileId,
              title: targetFile.name,
              url: targetFile.webViewLink,
              kind: workspaceKind(targetFile.mimeType),
              action: 'read' as const,
            }
          : undefined
      return CommandResult.success({ report, files: withReadTarget(state.files, readTarget), steps, artifact, timing })
    } catch (err) {
      missionSpan.finish(thrownOutcome(err))
      return CommandResult.error(err instanceof Error ? err.message : String(err))
    } finally {
      // Staged image uploads are only a fetch vehicle — Google copies the
      // bytes at insert time, so the Drive copies must not outlive the mission.
      for (const upload of state.tempUploads) {
        try {
          await deleteFile(client, upload.id)
          log(`Deleted staged image "${upload.name}"`)
        } catch {
          log(`Could not delete staged image "${upload.name}" — remove it from Drive manually`)
        }
      }
    }
  }
}
