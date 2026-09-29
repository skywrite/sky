import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { McpClient, McpTextContent } from '#lib/browser/mcp/client.ts'
import { launchPrivateBrowser } from '#lib/browser/signIn/launch.ts'
import { readJson, writeJson } from '#lib/jobs/files.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { LinkedInBrowserResult } from './browser.ts'
import type { ProfileEvidence } from './evidence.ts'
import { extractProfile } from './extract.ts'
import { linkedInUrl, type LinkedInDraft, type LinkedInImportPhase } from './types.ts'

export interface LinkedInInput {
  url: string
  progressFile: string
  cancelFile: string
}

interface ImportDependencies {
  launch: (
    options: Parameters<typeof launchPrivateBrowser>[0],
    signal: AbortSignal,
  ) => Promise<Pick<McpClient, 'callTool' | 'close'>>
  extract: typeof extractProfile
}

const stages = {
  opening: 'Opening the LinkedIn profile in a private browser…',
  signing_in: 'Approve Sky’s sign-in request and choose your LinkedIn login in the dialog on this computer.',
  waiting: 'Finishing LinkedIn sign-in…',
  needs_user: 'Finish signing in or complete verification in the browser window. Sky will continue automatically.',
  loading_profile: 'The requested profile is open. Waiting for its content to become readable…',
  reading: 'Reading the selected profile…',
}

/** The job and model receive only progress and scrubbed profile evidence from the private worker. */
export default async function importLinkedIn(
  input: LinkedInInput,
  dependencies: ImportDependencies = { launch: launchPrivateBrowser, extract: extractProfile },
): Promise<LinkedInDraft> {
  const url = linkedInUrl(input.url)
  const abort = new AbortController()
  const cancelled = async () => {
    try {
      if (await readJson(input.cancelFile)) abort.abort(new Error('Import cancelled.'))
    } catch {
      abort.abort(new Error('Unable to check import cancellation. Please retry.'))
    }
  }
  await cancelled()
  abort.signal.throwIfAborted()
  const timer = setInterval(() => {
    void cancelled()
  }, 250)
  let filesDir: string | undefined
  let browser: Pick<McpClient, 'callTool' | 'close'> | undefined
  const startedAt = ZonedDateTime.now().epochMilliseconds
  const progress = (stage: string, phase: LinkedInImportPhase) =>
    writeJson(input.progressFile, { stage, phase, startedAt })
  try {
    filesDir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-import-'))
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(5 * 60_000)])
    let source: ProfileEvidence
    let failureMessage = 'The LinkedIn profile could not be imported. Retry the import, or enter the person manually.'
    try {
      await progress(stages.opening, 'opening')
      browser = await dependencies.launch(
        {
          objective: `Import LinkedIn profile: ${url}`,
          linkedInProfile: url,
          filesDir,
        },
        signal,
      )
      let lastStage = stages.opening
      for (;;) {
        signal.throwIfAborted()
        const reply = await browser.callTool('linkedin_step', {}, { signal, timeoutMs: 300_000 })
        if (reply.isError) throw new Error('Private browser operation failed')
        const content = reply.content.find((part): part is McpTextContent => part.type === 'text' && 'text' in part)
        const outcome = LinkedInBrowserResult.parse(JSON.parse(content?.text ?? ''))
        if (outcome.status === 'failed') {
          failureMessage =
            'LinkedIn opened the profile, but Sky could not read its content. Retry the import, or enter the person manually.'
          throw new Error('Profile unreadable')
        }
        if (outcome.status === 'ready') {
          source = outcome.profile
          if (source.url !== url) throw new Error('Unexpected profile')
          break
        }
        const stage = stages[outcome.status]
        if (stage !== lastStage) await progress(stage, outcome.status)
        lastStage = stage
        await delay(500, undefined, { signal })
      }
    } catch {
      abort.signal.throwIfAborted()
      throw new Error(failureMessage)
    } finally {
      // Authentication is finished before the extraction model runs. No signed-in session is retained.
      await browser?.close()
      browser = undefined
    }
    abort.signal.throwIfAborted()
    await progress('Preparing an editable draft…', 'preparing')
    try {
      return await runWithUsageSource('people:linkedin', () => dependencies.extract(source, abort.signal))
    } catch {
      abort.signal.throwIfAborted()
      return {
        url,
        name: source.name,
        title: '',
        location: '',
        about: '',
        current: [],
        past: [],
        warning:
          'The profile opened, but automatic extraction could not finish. You can fill in the remaining details.',
      }
    }
  } finally {
    clearInterval(timer)
    await browser?.close()
    if (filesDir) await rm(filesDir, { recursive: true, force: true })
  }
}
