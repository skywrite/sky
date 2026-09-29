import { setTimeout as delay } from 'node:timers/promises'
import type { ElementHandle, Page } from 'playwright'
import type { SignInTarget } from '#lib/browser/signIn/broker.ts'
import type { LoginValues } from '#lib/credentials/login.ts'

/** LinkedIn's current login page uses JavaScript controls without an HTML form. */
export async function captureLinkedInSignIn(
  page: Page,
  protect: (origin: string, values: LoginValues) => void,
): Promise<SignInTarget | null> {
  // The visible password control appears before hydration replaces the initial controls.
  // Retry capture briefly; never carry approval across that replacement.
  for (let attempt = 0; attempt < 10; attempt++) {
    const url = new URL(page.url())
    if (page.isClosed() || url.origin !== 'https://www.linkedin.com' || !/^\/login\/?$/.test(url.pathname)) return null
    const target = await captureControls(page, protect)
    if (target) return target
    await delay(200)
  }
  return null
}

async function captureControls(
  page: Page,
  protect: (origin: string, values: LoginValues) => void,
): Promise<SignInTarget | null> {
  const origin = 'https://www.linkedin.com'
  const url = new URL(page.url())
  if (url.origin !== origin || !/^\/login\/?$/.test(url.pathname)) return null
  const usernames = page.locator('input[autocomplete~="username"]:visible')
  const passwords = page.locator('input[type="password"][autocomplete="current-password"]:visible')
  const buttons = page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true })
  if ((await usernames.count()) !== 1 || (await passwords.count()) !== 1 || (await buttons.count()) !== 1) return null
  const username = (await usernames.elementHandle()) as ElementHandle<HTMLInputElement> | null
  const password = (await passwords.elementHandle()) as ElementHandle<HTMLInputElement> | null
  const submit = await buttons.elementHandle()
  const dispose = async () => {
    await Promise.allSettled([username?.dispose(), password?.dispose(), submit?.dispose()])
  }
  if (!username || !password || !submit) {
    await dispose()
    return null
  }
  const current = async (): Promise<boolean> => {
    try {
      return await password.evaluate(
        (password, { username, submit, origin, pathname }) => {
          const main = password.closest('main, [role="main"]')
          const visible = (element: Element) =>
            element.isConnected &&
            document.contains(element) &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
          return (
            window === window.top &&
            location.origin === origin &&
            location.pathname === pathname &&
            main !== null &&
            main.contains(username) &&
            main.contains(submit) &&
            visible(password) &&
            visible(username) &&
            visible(submit) &&
            password.form === null &&
            username.form === null &&
            password.type === 'password' &&
            password.autocomplete === 'current-password' &&
            ['text', 'email'].includes(username.type) &&
            username.autocomplete.split(/\s+/).includes('username') &&
            !password.disabled &&
            !password.readOnly &&
            !username.disabled &&
            !username.readOnly &&
            submit instanceof HTMLButtonElement &&
            submit.form === null &&
            submit.type === 'button' &&
            !submit.disabled &&
            submit.textContent?.trim().toLowerCase() === 'sign in'
          )
        },
        { username, submit, origin, pathname: url.pathname },
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
      // Install the shared origin/network guard and redactor before either value reaches the page.
      protect(origin, values)
      await values.username.use((value) => username.fill(value, { timeout: 5000 }))
      if (!(await current())) return 'needs_user'
      await values.password.use((value) => password.fill(value, { timeout: 5000 }))
      if (!(await current())) return 'needs_user'
      await submit.click({ timeout: 5000 })
      return 'submitted'
    },
  }
}
