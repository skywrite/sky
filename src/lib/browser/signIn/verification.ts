import type { ElementHandle, Page } from 'playwright'
import { secureOrigin } from '#lib/credentials/login.ts'
import type { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import type { VerificationTarget } from './broker.ts'

// Also hide common code controls without autocomplete, including the manual SMS/Authy handoff.
const codeFields = [
  'input[autocomplete~="one-time-code"]',
  'input[name="otp" i]',
  'input[name="totp" i]',
  'input[name="code" i]',
  'input[name="pin" i]',
  'input[name="verificationCode" i]',
  'input[name="verification_code" i]',
  'input[name="security_code" i]',
  'input[id="otp" i]',
  'input[id="totp" i]',
  'input[id="pin" i]',
  'input[aria-label*="verification code" i]',
  'input[aria-label*="authenticator code" i]',
]
  .map((selector) => `${selector}:visible`)
  .join(', ')

export async function verificationVisible(page: Page): Promise<boolean> {
  // Embedded challenges stay manual too; do not expose their controls through an ordinary snapshot.
  for (const frame of page.frames()) {
    if (
      (await frame
        .locator(codeFields)
        .count()
        .catch(() => 1)) > 0
    )
      return true
  }
  return false
}

/** One empty code field in a same-origin POST form. Split boxes, SMS/email, and ambiguous forms stay manual. */
export async function captureVerificationForm(
  page: Page,
  protect: (code: SensitiveValue) => void,
): Promise<VerificationTarget | null> {
  const href = page.url()
  const origin = secureOrigin(href)
  if (!origin || (await page.locator('input[type="password"]:visible').count())) return null
  const fields = page.locator(codeFields)
  if ((await fields.count()) !== 1) return null
  const field = (await fields.elementHandle()) as ElementHandle<HTMLInputElement> | null
  if (!field) return null
  const formHandle = await field.evaluateHandle((field) => field.form)
  const form = formHandle.asElement() as ElementHandle<HTMLFormElement> | null
  if (!form) {
    await Promise.allSettled([field.dispose(), formHandle.dispose()])
    return null
  }
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
    await Promise.allSettled([field.dispose(), formHandle.dispose(), submitHandle.dispose()])
  }
  if (!submit) {
    await dispose()
    return null
  }
  const action = await form.evaluate((form) => form.action)
  const identity = await field.evaluate((field) => ({
    name: field.name,
    id: field.id,
    type: field.type,
    autocomplete: field.autocomplete,
  }))
  let filled = false
  const current = async () => {
    try {
      return await form.evaluate(
        (form, { field, submit, href, origin, action, identity, filled }) => {
          const visible = (element: Element) =>
            element.isConnected &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden' &&
            getComputedStyle(element).display !== 'none'
          const context = (form.closest('main, [role="main"]') ?? document.body).textContent ?? ''
          const otherInputs = [...form.elements].filter(
            (element) =>
              (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLSelectElement) &&
              element !== field &&
              visible(element) &&
              !element.disabled &&
              !['hidden', 'submit', 'button', 'checkbox'].includes(element.type),
          )
          return (
            window === window.top &&
            location.href === href &&
            location.origin === origin &&
            document.contains(form) &&
            form.action === action &&
            new URL(action).origin === origin &&
            form.method.toLowerCase() === 'post' &&
            (!form.target || form.target === '_self') &&
            visible(field) &&
            field.form === form &&
            ['text', 'tel', 'number'].includes(field.type) &&
            field.name === identity.name &&
            field.id === identity.id &&
            field.type === identity.type &&
            field.autocomplete === identity.autocomplete &&
            !field.disabled &&
            !field.readOnly &&
            (filled || field.value === '') &&
            otherInputs.length === 0 &&
            !/\b(?:sms|texted|emailed)\b|text message|(?:code|sent|send)[\s\S]{0,80}(?:phone|email|inbox|mobile|number)|\b(?:backup|recovery) code/i.test(
              context,
            ) &&
            visible(submit) &&
            (submit instanceof HTMLButtonElement || submit instanceof HTMLInputElement) &&
            submit.form === form &&
            submit.type === 'submit' &&
            !submit.disabled &&
            !submit.hasAttribute('formaction') &&
            !submit.hasAttribute('formmethod') &&
            !submit.hasAttribute('formtarget')
          )
        },
        { field, submit, href, origin, action, identity, filled },
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
    async submit(otp, authorized) {
      if (!(await authorized())) return 'needs_user'
      protect(otp.code)
      // Values and native handles never go through the model's tool arguments or logs.
      await otp.code.use((value) => field.fill(value, { timeout: 5000 }))
      filled = true
      if (!(await authorized())) return 'needs_user'
      await submit.click({ timeout: 5000 })
      return 'submitted'
    },
  }
}
