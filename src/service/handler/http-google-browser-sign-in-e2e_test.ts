import { calendarBrowserSignedIn, signInGoogleBrowserContext } from '#lib/google/browserSignIn.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'Google browser sign-in verifies the selected account and cancellation closes the window', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Mock sign-in notebook\n', tempPrefix: 'sky-browser-sign-in-' },
      async ({ page }) => {
        const context = page.context()
        const account = 'organizer@example.com'
        const requests: string[] = []
        await context.route('**/*', async (route) => {
          requests.push(route.request().method())
          const url = new URL(route.request().url())
          await route.fulfill({
            contentType: 'text/html',
            body:
              url.hostname === 'accounts.google.com'
                ? '<button onclick="location.href=\'https://calendar.google.com/calendar/u/0/r\'">Continue with another account</button>'
                : '<button id="identity" aria-label="Google Account: Other (other@example.com)">Account</button><button onclick="document.getElementById(\'identity\').setAttribute(\'aria-label\', \'Google Account: Organizer (organizer@example.com)\')">Choose organizer account</button>',
          })
        })
        const opened = Promise.withResolvers<void>()
        let verified = false
        const signing = signInGoogleBrowserContext(context, { account, onOpened: () => opened.resolve() }).then(() => {
          verified = true
        })
        await opened.promise
        await page.getByRole('button', { name: 'Continue with another account' }).click()
        await page.getByRole('button', { name: 'Choose organizer account' }).waitFor()
        assert({
          given: 'a Calendar page signed in to another account',
          should: 'keep waiting instead of mistaking a redirect or any Google login for the selected organizer',
          actual: [await calendarBrowserSignedIn(page, account), verified],
          expected: [false, false],
        })
        await page.getByRole('button', { name: 'Choose organizer account' }).click()
        await signing
        assert({
          given: 'the selected organizer verified after the page settles',
          should: 'finish sign-in without opening an event editor or performing an external write',
          actual: [
            verified,
            await calendarBrowserSignedIn(page, account),
            requests.every((method) => method === 'GET'),
          ],
          expected: [true, true, true],
        })
        const controller = new AbortController()
        const reopened = Promise.withResolvers<void>()
        const cancelled = signInGoogleBrowserContext(context, {
          account,
          signal: controller.signal,
          onOpened: () => reopened.resolve(),
        }).then(
          () => false,
          () => true,
        )
        await reopened.promise
        controller.abort()
        const rejected = await cancelled
        await context.close()
        assert({
          given: 'Cancel while the sign-in form is open',
          should: 'stop the attempt and close its browser context',
          actual: [rejected, context.pages().length],
          expected: [true, 0],
        })
      },
    )
  },
)
