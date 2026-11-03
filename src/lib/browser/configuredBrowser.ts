import { connectExistingBrowser } from './existing/connection.ts'
import { ExistingBrowserSettingsStore } from './existing/settings.ts'
import { browserSessionForPage, withPersistentBrowser, type BrowserSession } from './persistentContext.ts'
import type { StoredLoginTarget } from './storedLogin.ts'
import { prepareStoredLoginPage } from './storedLoginPage.ts'

interface Dependencies {
  settings: Pick<ExistingBrowserSettingsStore, 'read' | 'token'>
  connect: typeof connectExistingBrowser
  persistent: typeof withPersistentBrowser
}

/** Integration browser selection follows Settings, including unattended commands. */
export async function withConfiguredBrowser<T>(
  fallback: Parameters<typeof withPersistentBrowser>[0],
  run: (session: BrowserSession, target: StoredLoginTarget) => Promise<T>,
  deps: Dependencies = {
    settings: new ExistingBrowserSettingsStore(),
    connect: connectExistingBrowser,
    persistent: withPersistentBrowser,
  },
): Promise<T> {
  const settings = await deps.settings.read()
  if (!settings) {
    return deps.persistent(fallback, async (session, context) => {
      const page = context.pages()[0] ?? (await context.newPage())
      await prepareStoredLoginPage(page)
      return run(session, { page })
    })
  }

  // An unavailable selected connection must never silently switch browser identities.
  const attached = await deps.connect(await deps.settings.token(), settings, { background: true })
  try {
    await prepareStoredLoginPage(attached.page)
    await attached.activateTaskTab?.()
    if (fallback.headless === false) await attached.showTaskWindow?.()
    return await run(browserSessionForPage(attached.page, true), {
      page: attached.page,
      protocol: attached.protocol,
    })
  } finally {
    // The connector closes only its owned tabs and disconnects; it never quits the person's Brave.
    await attached.close()
  }
}
