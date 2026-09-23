import { setTimeout as delay } from 'node:timers/promises'
import { withPersistentBrowser } from '#lib/browser/persistentContext.ts'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { extractProfile, readProfileEvidence } from './extract.ts'
import { linkedInUrl, type LinkedInDraft } from './types.ts'

export interface LinkedInInput {
  url: string
  profileDir: string
  progressFile: string
  cancelFile: string
}

export default async function importLinkedIn(input: LinkedInInput): Promise<LinkedInDraft> {
  const url = linkedInUrl(input.url)
  const progress = (stage: string) => writeJson(input.progressFile, { stage })
  const abort = new AbortController()
  const cancelled = async () => {
    if (await readJson(input.cancelFile)) abort.abort(new Error('Import cancelled.'))
    abort.signal.throwIfAborted()
  }
  await cancelled()
  await progress('Opening LinkedIn in the Sky browser…')
  return withProcessLock(`${input.profileDir}.lock`, () =>
    withPersistentBrowser({ profileDir: input.profileDir, headless: false }, async (session, context) => {
      const page = context.pages()[0]
      await session.visit(url)
      const deadline = performance.now() + 5 * 60_000
      let ready = false
      await progress(
        'Sign in or finish any verification in the browser window. Sky will continue when the profile appears.',
      )
      while (performance.now() < deadline) {
        await cancelled()
        if (page.isClosed()) throw new Error('The browser was closed. Retry the import, or enter the person manually.')
        const current = new URL(page.url())
        if (!/(^|\.)linkedin\.com$/i.test(current.hostname))
          throw new Error('The browser left LinkedIn. Open the profile and try again.')
        let atTarget = false
        try {
          atTarget = linkedInUrl(page.url()).toLowerCase() === url.toLowerCase()
        } catch {
          /* Sign-in and verification paths are expected. */
        }
        const login = await page.locator('input[type="password"]:visible').count()
        if (
          atTarget &&
          !login &&
          (await page
            .locator('main h1')
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          ready = true
          break
        }
        if (!login && /^\/(?:feed|mynetwork)(?:\/|$)/.test(current.pathname)) await session.visit(url)
        await delay(1000)
      }
      if (!ready)
        throw new Error(
          'The LinkedIn profile did not become available. Retry after signing in, or enter the person manually.',
        )
      await progress('Reading the profile…')
      // Scrolling loads the profile sections without following unrelated profiles.
      for (let step = 0; step < 4; step++) {
        await cancelled()
        await page.mouse.wheel(0, 650)
        await delay(400)
      }
      const stillAtTarget = () => {
        try {
          return linkedInUrl(page.url()).toLowerCase() === url.toLowerCase()
        } catch {
          return false
        }
      }
      if (!stillAtTarget()) throw new Error('The browser changed profiles. Retry with the profile you want to import.')
      const source = await readProfileEvidence(page, url)
      if (!stillAtTarget()) throw new Error('The browser changed profiles while reading. Try importing it again.')
      await progress('Preparing an editable draft…')
      const timer = setInterval(() => {
        void cancelled().catch(() => {})
      }, 500)
      try {
        return await runWithUsageSource('people:linkedin', () => extractProfile(source, abort.signal))
      } catch (error) {
        abort.signal.throwIfAborted()
        return {
          url,
          name: source.name,
          title: '',
          location: '',
          about: '',
          current: [],
          past: [],
          warning: `The profile opened, but automatic extraction could not finish. You can fill in the remaining details. ${error instanceof Error ? error.message : ''}`,
        }
      } finally {
        clearInterval(timer)
      }
    }),
  )
}
