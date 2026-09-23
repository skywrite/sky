import type { Page } from 'playwright'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { GOOGLE_CONSOLE_URL } from '../setup.ts'
import { CLIENT_ENTRY_NAME, GOOGLE_SECRETS_CATEGORY, isClientEntryName } from '../tokens.ts'
import { StepFailed, appears, click, fill, goTo } from './page.ts'
import { forgetProjects, readLedger } from './resume.ts'

// A run that stopped before its project served anyone leaves that project
// behind. The tidy-up, at the end of a run that got through, shuts those
// down: only projects Sky itself chose an id for (the ledger), and never
// one an account still refreshes with. Google keeps a shut-down project
// for 30 days before it goes for good.

/** The projects some account still uses: named by its client entry, `client:<projectId>`. */
async function projectsInUse(secrets: SecretsProvider): Promise<Set<string>> {
  const entries = await secrets.list(GOOGLE_SECRETS_CATEGORY)
  const used = new Set<string>()
  for (const entry of entries) {
    if (isClientEntryName(entry.name) && entry.name !== CLIENT_ENTRY_NAME) {
      used.add(entry.name.slice(CLIENT_ENTRY_NAME.length + 1))
    }
  }
  return used
}

/** Which of Sky's projects nobody uses, the one just made aside. */
export async function leftoverProjects(secrets: SecretsProvider, keep: string, ledgerFile?: string): Promise<string[]> {
  const used = await projectsInUse(secrets)
  const ledger = await readLedger(ledgerFile)
  return ledger.projects.map((p) => p.id).filter((id) => id !== keep && !used.has(id))
}

/**
 * Shut the leftovers down in the console, one at a time from each project's
 * own settings page — Google asks for the id to be typed back there, which
 * is also the guard against shutting down anything else. Resolves with the
 * ids that are gone.
 */
export async function tidyProjects(
  page: Page,
  options: { secrets: SecretsProvider; keep: string; ledgerFile?: string },
): Promise<string[]> {
  const leftovers = await leftoverProjects(options.secrets, options.keep, options.ledgerFile)
  const gone: string[] = []
  for (const id of leftovers) {
    await goTo(page, `${GOOGLE_CONSOLE_URL}/iam-admin/settings?project=${id}`)
    // A project the console no longer knows is already gone.
    if (await appears(page.getByText(/additional access|not found|pending deletion|scheduled for deletion/i), 8000)) {
      gone.push(id)
      continue
    }
    const shutDown = page.getByRole('button', { name: /shut ?down/i })
    if (!(await appears(shutDown, 20_000))) throw new StepFailed(`Could not find the Shut down button for ${id}`)
    await click(shutDown, `the Shut down button for ${id}`)
    const dialog = page.getByRole('dialog').first()
    if (!(await appears(dialog, 15_000))) throw new StepFailed(`The shut-down dialog for ${id} did not open`)
    const confirmField = dialog.getByRole('textbox')
    if (await appears(confirmField, 5000)) await fill(confirmField.first(), id, `the confirmation field for ${id}`)
    await click(dialog.getByRole('button', { name: /shut ?down/i }), `the dialog's Shut down button for ${id}`)
    await page.waitForTimeout(4000)
    gone.push(id)
  }
  if (gone.length > 0) await forgetProjects(gone, options.ledgerFile)
  return gone
}
