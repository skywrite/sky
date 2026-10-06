import { z } from 'zod'

const resultSchema = z.object({
  status: z.enum(['submitted', 'navigated', 'needs_user', 'declined', 'unavailable']),
  origin: z.string().max(2000).optional(),
  operation: z.enum(['activate', 'inspect', 'connect', 'list', 'read', 'submit']).optional(),
  reason: z
    .enum([
      'not_connected',
      'page_changed',
      'inspection_failed',
      'browser_unavailable',
      'browser_timeout',
      'lookup_not_approved',
      'login_not_selected',
      'no_matching_login',
      'provider_unavailable',
      'provider_access_required',
      'login_incomplete',
      'submission_failed',
      'blocked_navigation',
      'approval_unavailable',
      'settings_changed',
      'unsupported_page',
      'browser_not_approved',
      'already_attempted',
      'busy',
      'cancelled',
    ])
    .optional(),
})

/** Only fixed outcomes cross the worker boundary; native errors may contain secrets. */
export type SignInResult = z.infer<typeof resultSchema>
export type SignInStatus = Exclude<SignInResult['status'], 'navigated'>

export function readSignInResult(text: string): SignInResult | null {
  try {
    return resultSchema.safeParse(JSON.parse(text)).data ?? null
  } catch {
    return null
  }
}

export function signInFailed(result: SignInResult | null): boolean {
  return (
    !result ||
    (!['submitted', 'navigated'].includes(result.status) && (result.status !== 'needs_user' || !!result.reason))
  )
}

/** The page URL is already public task context. Never include its query, fragment, or userinfo. */
export function signInProblem(result: SignInResult | null, pageUrl: string): string {
  let site = 'this website'
  try {
    const url = new URL(result?.reason === 'blocked_navigation' && result.origin ? result.origin : pageUrl)
    if (url.protocol === 'https:' || url.protocol === 'http:') site = url.origin
  } catch {
    // A blank or unavailable page still gets a useful explanation.
  }
  const next = ' Resume the plan to start a fresh sign-in attempt.'
  switch (result?.reason) {
    case 'not_connected':
      return `No 1Password account is connected for ${site}. Connect it in Sky’s Browser automation settings, or choose In browser next time.${next}`
    case 'page_changed':
      return `The sign-in form at ${site} changed while Sky was preparing sign-in. Sky stopped using that form.${next}`
    case 'inspection_failed':
      return `Sky could not inspect the sign-in page at ${site}. This attempt failed before requesting a saved login.${next}`
    case 'browser_unavailable':
      return `Sky lost access to its browser tab for ${site} before it could request a saved login. Reopen the connected browser if it was closed.${next}`
    case 'browser_timeout':
      return `The browser did not respond while Sky was ${result.operation === 'activate' ? 'activating' : 'inspecting'} the sign-in tab for ${site}. No saved login was requested.${next}`
    case 'lookup_not_approved':
      return `Sky did not receive permission to use 1Password for ${site}. The sign-in approval dialog was cancelled or expired.${next}`
    case 'login_not_selected':
      return `No 1Password login was selected for ${site}. The login chooser was cancelled or expired.${next}`
    case 'no_matching_login':
      return `No available 1Password login permits filling at ${site}. Review the saved website address, autofill settings and included vaults, or complete sign-in in the browser.${next}`
    case 'provider_access_required':
      return `1Password needs access restored before Sky can sign in at ${site}. Open and unlock 1Password, then reconnect it in Sky’s Browser automation settings.${next}`
    case 'approval_unavailable':
      return `Sky’s native sign-in dialog failed for ${site}. Sky could not record your choice, so this sign-in attempt stopped.${next}`
    case 'provider_unavailable':
      if (result.operation === 'connect')
        return `Sky could not connect to 1Password for ${site}. No login was read or submitted. Open 1Password and check whether it has an access request waiting.${next}`
      if (result.operation === 'list')
        return `Sky connected to 1Password but could not finish looking up logins for ${site}. No login was submitted.${next}`
      if (result.operation === 'read')
        return `Sky found a login for ${site}, but 1Password could not return its sign-in fields. No login was submitted.${next}`
      return `1Password could not complete the sign-in request for ${site}. Sky could not establish which provider operation failed.${next}`
    case 'login_incomplete':
      return `The selected 1Password login for ${site} does not have a supported username and password. Choose another saved login, or complete this site's sign-in in the browser.${next}`
    case 'submission_failed':
      return `1Password supplied the login for ${site}, but Sky could not finish filling or submitting the website's sign-in form. Check the website before retrying; sign-in may have been submitted.${next}`
    case 'blocked_navigation':
      return `Sky blocked the website’s navigation to ${site} because it could not safely forward that request. The blocked page cannot complete sign-in. Open the website’s dedicated sign-in page before retrying; changing Brave settings will not resolve this Sky restriction.${next}`
    case 'settings_changed':
      return `The 1Password account or vault permissions changed during sign-in at ${site}. Review the connection in Sky’s Browser automation settings.${next}`
    case 'unsupported_page':
      return `Sky does not support the sign-in form at ${site}, so it did not request a saved login. Sign in manually in your browser, then resume the plan to reuse that session.`
    case 'browser_not_approved':
      return `The private browser sign-in for ${site} was cancelled, expired, or did not return to the original website. That browser session was closed.${next}`
    case 'already_attempted':
      return `The sign-in attempt at ${site} did not finish. Sky will not repeat a credential request in this browser session.${next}`
    case 'cancelled':
      return `Sign-in at ${site} was stopped.${next}`
    case 'busy':
      return `The private browser was still handling another sign-in request for ${site}.${next}`
    default:
      return result?.status === 'declined'
        ? `Sign-in at ${site} was not approved or its approval expired.${next}`
        : `Sky could not complete sign-in at ${site}.${next}`
  }
}
