import type { Page } from 'playwright'

const prepared = new WeakSet<Page>()

/** An integration already supplies its own Keychain login on this owned tab. */
export async function prepareStoredLoginPage(page: Page): Promise<void> {
  if (prepared.has(page)) return
  const ignorePasswordManagerOffers = () => {
    const ignore = () => document.body?.setAttribute('data-1p-ignore', '')
    // The body does not exist at document start and can be replaced during hydration.
    new MutationObserver(ignore).observe(document, { childList: true, subtree: true })
    ignore()
  }
  // A foreign extension iframe makes Chrome detach the Playwright debugger.
  // Opt out before navigation, including an auth probe that redirects to login.
  // This changes only our page, never the person's password-manager settings.
  await page.addInitScript(ignorePasswordManagerOffers)
  await page.evaluate(ignorePasswordManagerOffers)
  prepared.add(page)
}
