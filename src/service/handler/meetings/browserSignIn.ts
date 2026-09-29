import type { CalendarBrowserHost, CalendarBrowserState } from '#lib/calendarScheduler/types.ts'

interface Check {
  value: CalendarBrowserState
  controller: AbortController
  operation: 'check' | 'signIn'
  done: boolean
  checkedAt: number
}

/** One visible sign-in window shared by both calendar API aliases and all meeting cards. */
export class CalendarBrowserConnection {
  private readonly checks = new Map<string, Check>()
  private signingIn?: Check

  constructor(
    private readonly host: CalendarBrowserHost,
    private readonly hold: () => () => void,
  ) {}

  status(account: string, refresh = false): CalendarBrowserState {
    if (this.signingIn && this.signingIn.value.account !== account)
      return {
        account,
        state: 'busy',
        message: 'A Google sign-in window is already open for another account. Finish or close it first.',
      }
    const check = this.checks.get(account)
    if (
      check &&
      (!check.done || (!refresh && (check.value.state !== 'signed_in' || performance.now() - check.checkedAt < 30_000)))
    )
      return check.value
    return this.begin(account, 'check')
  }

  signIn(account: string): CalendarBrowserState {
    if (this.signingIn) return this.status(account)
    this.checks.get(account)?.controller.abort()
    return this.begin(account, 'signIn')
  }

  cancel(account: string): CalendarBrowserState {
    const check = this.checks.get(account)
    check?.controller.abort()
    if (check && !check.done)
      check.value = {
        account,
        state: 'sign_in_required',
        message: 'Sign-in cancelled. Your meeting draft is unchanged.',
      }
    return check?.value ?? { account, state: 'sign_in_required' }
  }

  private begin(account: string, operation: Check['operation']): CalendarBrowserState {
    const check: Check = {
      value: { account, state: operation === 'check' ? 'checking' : 'opening' },
      operation,
      controller: new AbortController(),
      done: false,
      checkedAt: 0,
    }
    this.checks.set(account, check)
    if (operation === 'signIn') this.signingIn = check
    const release = this.hold()
    const current = () => this.checks.get(account) === check && !check.controller.signal.aborted
    void (async () => {
      try {
        const ready =
          operation === 'check'
            ? await this.host.check(account, check.controller.signal)
            : await this.host
                .signIn(account, check.controller.signal, () => {
                  if (current()) check.value = { account, state: 'waiting' }
                })
                .then(() => true)
        if (current()) check.value = { account, state: ready ? 'signed_in' : 'sign_in_required' }
      } catch (error) {
        if (current())
          check.value = {
            account,
            state: 'failed',
            message: error instanceof Error ? error.message : 'Google sign-in could not be checked.',
          }
      } finally {
        check.done = true
        check.checkedAt = performance.now()
        if (this.signingIn === check) this.signingIn = undefined
        release()
      }
    })()
    return check.value
  }
}
