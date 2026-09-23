import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { DIR_LOGS } from '#shared/log.ts'
import type { SetupPhaseKey } from './state.ts'

// A step Sky could not do leaves a picture and the page's accessibility
// tree behind, so the next fix is made from what the console actually
// showed, not from memory. Logs are ephemeral by design (see shared/log.ts).
// The client step's dialog holds the secret Google shows once: no picture
// of it, and its tree only with the pair masked.

export const SETUP_DIAGNOSTICS_DIR = path.join(DIR_LOGS, 'google-setup')

/** The client step's page can show the secret: no picture, and the tree with the pair masked. */
const REDACTED: ReadonlySet<SetupPhaseKey> = new Set(['client'])

function masked(tree: string): string {
  return tree.replace(/GOCSPX-[\w-]+/g, '[secret]').replace(/[\w-]+\.apps\.googleusercontent\.com/g, '[client-id]')
}

/** Where the files went, or null when none were written. `when` tells a trace ("after") from a failure. */
export async function captureStepDiagnostics(
  page: Page,
  runId: string,
  step: SetupPhaseKey,
  when: 'failed' | 'after' = 'failed',
): Promise<string | null> {
  try {
    await mkdir(SETUP_DIAGNOSTICS_DIR, { recursive: true })
    const base = path.join(SETUP_DIAGNOSTICS_DIR, `${runId}-${step}${when === 'after' ? '-after' : ''}`)
    const redact = REDACTED.has(step)
    if (!redact) await page.screenshot({ path: `${base}.png`, fullPage: false })
    const tree = await page.locator('body').ariaSnapshot()
    await writeFile(`${base}.aria.yml`, `# ${page.url()}\n${redact ? masked(tree) : tree}\n`, 'utf8')
    return base
  } catch {
    return null
  }
}
