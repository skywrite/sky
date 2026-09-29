import type { ElementHandle, Page } from 'playwright'
import type { LoginValues } from '#lib/credentials/login.ts'
import { secureOrigin } from '#lib/credentials/login.ts'
import type { SignInTarget } from './broker.ts'

/** Ambiguous, embedded, username-first, and registration forms require the person in this first flow. */
export async function captureSignInForm(
  page: Page,
  protect: (origin: string, values: LoginValues) => void,
): Promise<SignInTarget | null> {
  const origin = secureOrigin(page.url())
  if (!origin) return null
  const passwords = page.locator('input[type="password"]:visible')
  if ((await passwords.count()) !== 1) return null
  const password = (await passwords.elementHandle()) as ElementHandle<HTMLInputElement> | null
  if (!password) return null
  const form = (
    await password.evaluateHandle((field) => field.form)
  ).asElement() as ElementHandle<HTMLFormElement> | null
  if (!form) {
    await password.dispose()
    return null
  }
  const usernameHandle = await form.evaluateHandle((form) => {
    const fields = [...form.elements].filter(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement &&
        ['text', 'email'].includes(element.type) &&
        !element.disabled &&
        !element.readOnly &&
        element.getClientRects().length > 0,
    )
    const named = fields.filter((field) => /^(username|email)$/.test(field.autocomplete))
    return named.length === 1 ? named[0] : fields.length === 1 ? fields[0] : null
  })
  const username = usernameHandle.asElement() as ElementHandle<HTMLInputElement> | null
  const submitHandle = await form.evaluateHandle((form) => {
    const buttons = [...form.elements].filter(
      (element) =>
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.type === 'submit' &&
        !element.disabled &&
        element.getClientRects().length > 0,
    )
    return buttons.length === 1 ? buttons[0] : null
  })
  const submit = submitHandle.asElement()
  const dispose = async () => {
    await Promise.allSettled([password.dispose(), form.dispose(), usernameHandle.dispose(), submitHandle.dispose()])
  }
  if (!username || !submit) {
    await dispose()
    return null
  }
  const action = await form.evaluate((element) => element.action)
  if (secureOrigin(action) !== origin) {
    await dispose()
    return null
  }
  const current = async (): Promise<boolean> => {
    try {
      return await form.evaluate(
        (form, { origin, action, password, username, submit }) => {
          const visible = (element: Element) =>
            element.isConnected &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
          return (
            window === window.top &&
            location.origin === origin &&
            document.contains(form) &&
            form.action === action &&
            new URL(form.action).origin === origin &&
            form.method.toLowerCase() === 'post' &&
            (!form.target || form.target === '_self') &&
            visible(password) &&
            visible(username) &&
            visible(submit) &&
            password.form === form &&
            username.form === form &&
            ['text', 'email'].includes(username.type) &&
            (submit instanceof HTMLButtonElement || submit instanceof HTMLInputElement) &&
            submit.form === form &&
            submit.type === 'submit' &&
            !submit.disabled &&
            password.type === 'password' &&
            password.autocomplete !== 'new-password' &&
            !password.disabled &&
            !password.readOnly &&
            !username.disabled &&
            !username.readOnly &&
            !submit.hasAttribute('formaction') &&
            !submit.hasAttribute('formmethod') &&
            !submit.hasAttribute('formtarget')
          )
        },
        { origin, action, password, username, submit },
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
      protect(origin, values)
      // Never use the general tool path: it records input arguments. Native handles stay in this process.
      await values.username.use((value) => username.fill(value, { timeout: 5000 }))
      if (!(await current())) return 'needs_user'
      await values.password.use((value) => password.fill(value, { timeout: 5000 }))
      if (!(await current())) return 'needs_user'
      await submit.click({ timeout: 5000 })
      return 'submitted'
    },
  }
}
