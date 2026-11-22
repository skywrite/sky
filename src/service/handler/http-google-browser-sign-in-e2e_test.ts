import { typeComment } from '#commands/all/google/agent/lib/browserComments.ts'
import { insertSuggestedText } from '#commands/all/google/agent/lib/browserSuggestions.ts'
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

test(
  {
    name: 'Suggested Google Doc text insertion reaches nested editor iframes and fallback inputs without touching system clipboard',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Mock suggestion notebook\n', tempPrefix: 'sky-doc-suggest-' },
      async ({ page }) => {
        await page.setContent(`
          <!doctype html>
          <html>
            <body>
              <iframe id="docs-target" class="docs-texteventtarget-iframe"></iframe>
              <textarea id="plain"></textarea>
              <div id="comment-box" class="docos-input-textarea" contenteditable="true" aria-label="Comment"></div>
              <script>
                window.pastedIntoIframe = null;
                window.submittedComment = null;
                const frame = document.getElementById('docs-target');
                frame.contentDocument.open();
                frame.contentDocument.write('<div id="ed" contenteditable="true"></div>');
                frame.contentDocument.close();
                const ed = frame.contentDocument.getElementById('ed');
                ed.addEventListener('paste', (event) => {
                  event.preventDefault();
                  window.pastedIntoIframe = event.clipboardData.getData('text/plain');
                });
                const commentBox = document.getElementById('comment-box');
                document.addEventListener('keydown', (event) => {
                  if (event.metaKey && event.altKey && event.code === 'KeyM') {
                    event.preventDefault();
                    commentBox.focus();
                  }
                  if (event.metaKey && event.key === 'Enter' && document.activeElement === commentBox) {
                    event.preventDefault();
                    window.submittedComment = commentBox.innerText;
                  }
                });
                frame.focus();
                ed.focus();
              </script>
            </body>
          </html>
        `)

        await insertSuggestedText(page, "consectetur tem'por -- elit")
        const pastedIntoIframe = await page.evaluate(
          () => (window as unknown as { pastedIntoIframe: string | null }).pastedIntoIframe,
        )

        await page.locator('#plain').focus()
        await insertSuggestedText(page, "fallback 'verbatim' -- text")
        const plainValue = await page.locator('#plain').inputValue()

        await typeComment(
          page,
          '**Make the desired outcome clearer**\n\n- Seek a material reduction.\n- Keep thresholds internal.',
        )
        const submittedComment = await page.evaluate(() =>
          ((window as unknown as { submittedComment: string | null }).submittedComment ?? '').replaceAll('\r\n', '\n'),
        )

        assert({
          given:
            'a focused Docs-style hidden iframe paste listener, a plain textarea, and a contenteditable comment box in Chromium',
          should: 'deliver verbatim text and preserve blank-line comment spacing without touching navigator.clipboard',
          actual: { pastedIntoIframe, plainValue, submittedComment },
          expected: {
            pastedIntoIframe: "consectetur tem'por -- elit",
            plainValue: "fallback 'verbatim' -- text",
            submittedComment:
              '*Make the desired outcome clearer*\n\n- Seek a material reduction.\n- Keep thresholds internal.',
          },
        })
      },
    )
  },
)
