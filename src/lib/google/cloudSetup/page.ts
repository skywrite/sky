import type { Locator, Page } from 'playwright'

// Small moves against the Cloud console. Everything is found by role and
// visible text, never by class or id: the console is redesigned often and
// the words move last. A miss is a StepFailed — the run shows the person
// the written step instead of dying.

/** A console step could not be done by Sky: an anchor was missing or the page did not settle. */
export class StepFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StepFailed'
  }
}

/** The console follows the account's language; English keeps the labels the code looks for. */
export function englishUrl(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('hl', 'en')
  return parsed.toString()
}

export async function goTo(page: Page, url: string): Promise<void> {
  try {
    await page.goto(englishUrl(url), { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } catch (err) {
    throw new StepFailed(`The console page did not load (${url}): ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Is it on the page now, or within the wait? Never throws. */
export async function appears(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

/** Click something the step needs; its absence is the step's failure, named by `what`. */
export async function click(locator: Locator, what: string, timeoutMs = 30_000): Promise<void> {
  try {
    await locator.first().click({ timeout: timeoutMs })
  } catch {
    throw new StepFailed(`Could not find ${what}`)
  }
}

export async function fill(locator: Locator, value: string, what: string, timeoutMs = 30_000): Promise<void> {
  try {
    await locator.first().fill(value, { timeout: timeoutMs })
  } catch {
    throw new StepFailed(`Could not find ${what}`)
  }
}

/** Waits until the page's URL matches; false on timeout. */
export async function urlBecomes(page: Page, test: (url: URL) => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (page.isClosed()) return false
    try {
      if (test(new URL(page.url()))) return true
    } catch {
      // about:blank and friends — keep waiting
    }
    await page.waitForTimeout(500).catch(() => undefined)
  }
  return false
}

export function hostOf(page: Page): string {
  try {
    return new URL(page.url()).hostname
  } catch {
    return ''
  }
}
