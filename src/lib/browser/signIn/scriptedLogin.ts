import type { Frame, Page } from 'playwright'
import { sameLoginWebsite, secureOrigin, type LoginValues } from '#lib/credentials/login.ts'
import type { SignInTarget } from './broker.ts'

/** A single labelled JavaScript login, in the main document or a visible same-website child frame. */
export async function captureScriptedLogin(
  page: Page,
  protect: (origin: string, values: LoginValues, frame: Frame) => void,
): Promise<SignInTarget | null> {
  const topOrigin = secureOrigin(page.url())
  if (!topOrigin) return null
  let selected: Frame | undefined
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      if (frame.parentFrame() !== page.mainFrame()) continue
      const element = await frame.frameElement().catch(() => null)
      const visible = element && (await element.isVisible())
      await element?.dispose()
      if (!visible) continue
    }
    const count = await frame.locator('input[type="password"]:visible').count()
    if (!count) continue
    if (selected || count !== 1) return null
    selected = frame
  }
  if (!selected || !sameLoginWebsite(topOrigin, selected.url())) return null
  const frame = selected
  const address = frame.url()
  const origin = secureOrigin(address)!
  let usernames = frame.locator('input[autocomplete~="username"]:visible')
  if ((await usernames.count()) !== 1)
    usernames = frame
      .getByRole('textbox', { name: /^(?:user\s*name|user\s*id|login\s*id|email(?: address)?)$/i })
      .filter({ visible: true })
  const buttons = frame.getByRole('button', { name: /^(?:sign|log)\s?in$/i }).filter({ visible: true })
  if ((await usernames.count()) !== 1 || (await buttons.count()) !== 1) return null
  const password = await frame.locator('input[type="password"]:visible').elementHandle()
  const username = await usernames.elementHandle()
  const submit = await buttons.elementHandle()
  const form = password ? await password.evaluateHandle((field) => (field as HTMLInputElement).form) : undefined
  const mainDocument = await page.evaluateHandle(() => window.document)
  const boundary = frame === page.mainFrame() ? undefined : await frame.frameElement()
  const dispose = async () => {
    await Promise.allSettled([
      password?.dispose(),
      username?.dispose(),
      submit?.dispose(),
      form?.dispose(),
      mainDocument.dispose(),
      boundary?.dispose(),
    ])
  }
  if (!password || !username || !submit || !form) {
    await dispose()
    return null
  }
  const current = async (): Promise<boolean> => {
    try {
      if (page.isClosed() || frame.isDetached()) return false
      if (
        !(await mainDocument.evaluate(
          (captured, origin) => captured === window.document && location.origin === origin,
          topOrigin,
        ))
      )
        return false
      if (boundary && !(await boundary.isVisible())) return false
      return await password.evaluate(
        (password, { username, submit, form, address }) => {
          const visible = (element: Element) =>
            element.isConnected &&
            document.contains(element) &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
          return (
            location.href === address &&
            password instanceof HTMLInputElement &&
            username instanceof HTMLInputElement &&
            submit instanceof HTMLButtonElement &&
            visible(password) &&
            visible(username) &&
            visible(submit) &&
            password.form === form &&
            username.form === form &&
            submit.form === form &&
            (form === null ||
              (form instanceof HTMLFormElement &&
                document.contains(form) &&
                !form.hasAttribute('method') &&
                !form.hasAttribute('action') &&
                !form.hasAttribute('target'))) &&
            ![password, username, submit].some((element) => element.hasAttribute('form')) &&
            !['formaction', 'formmethod', 'formtarget'].some((name) => submit.hasAttribute(name)) &&
            password.type === 'password' &&
            password.autocomplete !== 'new-password' &&
            ['text', 'email'].includes(username.type) &&
            !password.disabled &&
            !password.readOnly &&
            !username.disabled &&
            !username.readOnly &&
            /^(?:sign|log)\s?in$/i.test(submit.textContent?.trim() ?? '')
          )
        },
        { username, submit, form, address },
      )
    } catch {
      return false
    }
  }
  if (!(await current())) {
    await dispose()
    return null
  }
  return {
    origin,
    current,
    dispose,
    async submit(values) {
      if (!(await current())) return 'needs_user'
      protect(origin, values, frame)
      // A JavaScript-only form can omit method/action. Never let its implicit
      // GET fallback put credentials into the address bar if its handler fails.
      await form.evaluate((form) => {
        if (form) form.addEventListener('submit', (event) => event.preventDefault(), { capture: true, once: true })
      })
      await values.username.use((value) => username.fill(value, { timeout: 5000 }))
      if (!(await current())) return 'needs_user'
      await values.password.use((value) => password.fill(value, { timeout: 5000 }))
      await submit.waitForElementState('enabled', { timeout: 5000 })
      if (!(await current())) return 'needs_user'
      await submit.click({ timeout: 5000 })
      return 'submitted'
    },
  }
}
