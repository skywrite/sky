---
created: 2026-09-25
updated: 2026-09-29
---

# Sky's browser

Sky can do things in a real browser window on the person's behalf: open a
site, sign in with their help, find what the task names, download files and
check them, upload files, fill forms. One command carries it today:

```
sky browser:task "Log in to my brokerage and download my 2025 tax forms to ~/Desktop/Taxes/"
```

The person watches the window. With a password manager configured, a task uses
the private browser described below. Other tasks retain the existing shared
browser. Unsupported sign-in steps and verification codes still pause for the
person; Enter means "done, look again". Nothing on a web page is an instruction.

## Credential-backed tasks

`signIn/worker.ts` owns a disposable Playwright browser and the 1Password SDK in
a separate process. The task communicates over inherited pipes using a small
MCP-compatible allowlist. There is no HTTP/CDP listener, token file, persisted
approval, or shared browser profile. Both the reasoning-model and Jev runners
use this worker when `browser:task` finds configured password managers. The
legacy shared driver is never attached to a credential-backed task, including
after a crash. Existing legacy sessions are not imported or changed.

The only model-facing authentication operation is `sign_in({})`. It accepts no
URL, account, field selector, credential reference, or approval flag. Trusted
code captures the current top-level document and a single unambiguous login
form. Two native macOS interactions authorize lookup for its exact HTTPS origin
and selection/use of a matching login. The native prompt is outside the Sky HTTP
API and model tools; the caller cannot answer it through a request. Cancellation
does not become a remembered grant. A second sign-in request on that origin in
the same task hands off to the person rather than repeating prompts.

Lookup considers saved accounts and vault exclusions. Filling is deliberately
stricter than provider discovery: an exact HTTPS origin including the port must
appear on the saved Login item, and never-fill entries are excluded. After
selection, code rechecks account/vault preferences, the concrete document and
form action, then reads the login and revalidates its website from one native
item revision. Values stay inside the worker and go directly to Playwright
element handles. The model receives only `submitted`, `needs_user`, `declined`,
or `unavailable`. Submission is not proof of authentication; the next snapshot
must show progress. Another task cannot reuse the approval or browser context.

This flow supports a visible username and current-password field in one
top-level, same-origin POST form with one submit control. LinkedIn's JavaScript
login has a separate, origin-and-path-bound adapter in `lib/linkedin/login.ts`:
its current login screen has no HTML form. That adapter captures the concrete
username, password and sign-in controls, revalidates them around native approval,
and installs the same network guard before filling. Username-first pages,
frames, popups, cross-origin identity providers, passkeys, and codes require the
person. After credential use, navigation is confined to the approved origin.
The worker combines Playwright routing with a private Chromium Fetch interceptor:
Playwright skips subsequent requests in an HTTP redirect chain, including 307
redirects that preserve a credential POST. The interceptor rechecks every hop
before sending it. It uses the existing browser pipe, never a CDP listener.
Native approval currently requires macOS. Future workflows must extend the
authorization boundary, not inject a login into the shared localhost driver.

The worker offers ordinary navigation, accessible snapshots, control actions,
and downloads. It offers no arbitrary JavaScript, console/network inspection,
storage/cookie export, screenshots, file upload, tab switching, or approval RPC.
Authentication pages stay hidden while password, username or one-time-code
entry is visible, including manual entry. URL query/fragment parameters are
omitted from page headers. Known login values and common encodings are redacted from text results;
download bodies and names containing them are withheld. No console log, snapshot,
video, or trace artifact is written by the worker. The task's `read_file` can read
only its downloaded files, including after symlink resolution. Cancellation
notifies and closes the worker; closing the task destroys its browser session.

The destination website necessarily receives its password. This boundary trusts
the approved origin and its scripts; string redaction cannot make a malicious
same-origin application safe or recognize every encoding in arbitrary downloaded
documents. It also does not defend against arbitrary local code running as the
OS user. The guarantee here is separation from ordinary Sky API access, other
browser tasks, and the model's allowed tool surface. Legacy shared-browser tasks
remain outside this boundary. Settings stores preferences only; see the
[settings boundary](../../../service/handler/settings/docs/README.md#password-manager-setup-boundary).

## LinkedIn Person import

Person import starts this same private worker, scoped at initialization to one
canonical LinkedIn profile. In this mode the worker exposes only `linkedin_step`:
fixed workflow progress followed by scrubbed profile evidence. The job cannot
request general navigation, snapshots, downloads, credential reads, or an approval
decision. Website credentials and the authenticated browser stay inside the
worker; the normal People HTTP API still exposes only job progress and a draft.

`lib/linkedin/browser.ts` owns the deterministic flow: open the profile, use the
shared sign-in broker once if needed, wait for the person to finish verification,
return from LinkedIn's feed to the selected profile, and capture its main content.
All navigation is confined to `https://www.linkedin.com`. The import job closes
the browser before sending evidence to its extraction model. Completion, failure,
cancellation, or the five-minute deadline disposes the session. The previous
persistent LinkedIn profile is neither read nor modified. No configured password
manager or a declined approval leaves manual sign-in available in the private
window. Codes, passkeys and unsupported login variants still require the person.

## How a task runs

The existing shared-browser path, used without a configured password manager:

1. `commands/all/browser/task.ts` makes a task folder and starts the run.
2. `lib/browser/mcp/browserDriver.ts` attaches the task to Sky's browser:
   Playwright's own MCP server, `playwright mcp`, from Sky's pinned
   Playwright, serving over HTTP on localhost, started once on Sky's one
   profile and left running with its window open. Each task opens a tab of
   its own and works there; the model never sees the tab tools, since the
   next tab may be another task's. A task that finishes closes its tab; one
   that stops or is killed leaves it where it was. The window and every
   sign-in in it stay for the next task. Five tasks at once are five tabs.
3. `lib/browser/mcp/client.ts` talks to it, standard MCP framing over HTTP
   (or over stdio, for a driver of one's own).
4. `lib/browser/mcp/tools.ts` turns the driver's tools into chat-engine
   tools. A screenshot reaches the model as an image, not as a filename. A
   download lands in the driver's folder and is moved into the task's own
   at once, so nothing is attributed to a later task.
5. `lib/browser/task/runTask.ts` runs Sky's chat engine with those tools,
   `wait_for_person`, and the host's own tools (`read_file`, `save_file`),
   under the rules in `task/prompt.ts`: look before acting, one move at a
   time, the person signs in, a download counts once the file was opened
   and checked.
6. The model's closing words become `report.md` in the task folder.

## Where things live

| Path | What |
| --- | --- |
| `~/.sky/browser/` | Sky's browser: `profile/` (every sign-in persists here), `driver.json` (the running driver's pid and port), `driver.log`, `downloads/` (the driver's landing place; each task moves its own out at once). Local to the Mac, like the Google profiles. |
| `~/.sky/browser/tasks/<date>_<HHMM>_<summary>/` | One folder per task |
| `…/files/` | Downloads and screenshots; the only place `save_file` moves from |
| `…/report.md` | What Sky did, saved, and could not do |
| `…/trace.jsonl` | Every step, plan and adviser reply as it happened |

## The Jev driver

The default. With the Experimental switch "Jev drives the browser" off, the
command hands the browser to the reasoning model instead. Jev's loop lives
in `lib/browser/jev/`. Code owns the loop and
TypeSafe's Jev picks each move, jev-ultrafast's shape drawn from the
accessibility snapshot instead of a page script:

1. `table.ts` turns a snapshot with bounding boxes into a numbered table of
   the controls in view: role, label, value, the text beside it, a
   dropdown's options. Frames come along; disabled and off-screen controls
   do not. A field that reads like a password or a code is marked secret.
2. `questions.ts` asks Jev everything in one request: which operation
   (click, type, select, scroll, wait, back, ask the person, done, blocked),
   which control for each operation that takes one, plus three yes/no
   judgments: does the page need the person, is the goal done, would the
   next move commit the person to something.
3. `decide.ts` checks the answers before anything runs: an option that was
   offered, probabilities that sum to one, a choice that is the most likely.
4. `runJevTask.ts` makes the move through the same browser server, looks
   again, and applies the gates in code: done at 0.85 (refused once while a
   goal that asks for a download has no file), the person at 0.85 or when
   Jev says so, a risky move asked first at 0.5, blocked after three unchanged
   pages, sixty steps at most. The person is asked once per page: after they
   continue, the loop looks again, waits three seconds and looks once more
   if Jev still asks, and then runs Jev's next-best move on that page rather
   than ask the same thing again.
5. `typeText.ts`: Jev cannot write, so the reasoning model, at medium
   effort, writes a field's text
   from the task and the page, once per field. Secret fields are never typed.
6. `advisor.ts`: the same model reads at the moments Jev cannot: a page seen
   for the first time, a move that failed, a page that did not change, Jev
   wanting the person. It answers with a one-line plan that goes into Jev's
   state, a judgment on whether the page really needs the person, and, when
   it is sure, the move itself: a click, a direct visit to a link's own
   address, an Escape for an overlay, a scroll, a wait. Its judgment
   overrules Jev's "needs you" on a signed-in page.
7. `epilogue.ts`: the ending Jev cannot write. Each downloaded file gets a
   short conversation of its own: the model opens it with `read_file` and says in
   three lines what it is and whether it fits the task. A file larger than
   the model can read is reported as unchecked, never a failed run. Then one
   last conversation, without the files, moves the right ones with
   `save_file` where the task says and writes the report. A reading that
   fails, the model unreachable, counts for nothing: Jev's own judgment
   stands. Network trouble in the ending is waited out, three tries with
   longer pauses, and a model that stays unreachable gets one try per turn
   from then on; if it still cannot write, the facts are written by code.
   A check only reads; the finishing turn alone moves files, told what is
   in the task folder at that moment, so a report never contradicts what
   was saved.
8. `trace.jsonl` in the task folder records every page, step, plan and
   adviser reply as they happen, so a run killed midway can still be read.
   When the view goes blank after a move, a download popup that closed
   being the usual cause, the loop finds the task's tab again or reopens
   its last page before going on, and the adviser may send the task back
   to any address it has been to.
9. The server is started with `mcp/serverGuard.ts` preloaded: an error it
   throws outside any tool call, such as a download whose popup closed
   before the handler finished, is a line in `browser-server.log` rather
   than the end of the process. Should the server die anyway, the loop
   starts it once more on the same page, the profile still holding the
   session, and the move that died counts as a failed move.

Without files the closing report is written by code from the trace. Jev's
decisions cost about a thousand tokens and a fraction of a second each; an
adviser reading a few thousand tokens and a third of a second. Both ride
the same usage log as every other model call.

## Which browser

Sky's browser is Playwright's own Chromium when it is installed, the build
Playwright is tested against; otherwise the first installed
Chromium-family browser. Brave was the first choice until 2026-09-27, when
it crashed on its main thread right after downloads four times in a
morning, the same Brave bug the Google-console work met. The crash reports
sit in `~/Library/Logs/DiagnosticReports/`, and Sky's own trace of each
crash is the download-handler line in `driver.log`. The download
bookkeeping a crash leaves behind (`Default/Download Service`) is cleared
at every launch, since Brave crashes on it again.

## Looking like a normal browser

A site's bot wall reads the browser's own tells, and a person signing in
through an automated window is turned away with them. The launcher keeps
the browser ordinary rather than disguised: Playwright's automation
switches that leave a mark on the page are dropped, `AutomationControlled`
is disabled so `navigator.webdriver` reads false as it does for anyone,
and no viewport is forced, so the window, the screen and its scale agree.
Nothing is spoofed: a masked property is itself a tell, and the earlier
`navigator.webdriver` mask was one. What remains is Playwright's own
control channel, which the patched build patchright closes if a site still
objects.

## What the model may not do

The server offers more tools than the model sees. Code execution in the
page or the server, request bodies with their headers, and closing the
browser stay out (`BROWSER_TOOL_NAMES` in `mcp/tools.ts`). `save_file`
moves only files from the task folder. Passwords and codes are the person's
to type; the prompt says so and `wait_for_person` is how Sky asks.

## The batch helper beside it

`persistentContext.ts` is the older, batch-oriented helper: launch a
signed-in profile, run a callback, close. The MyFitnessPal fetch uses it.
LinkedIn import uses the private worker above.

## Verified

- 2026-09-27, Playwright's Chromium as Sky's browser: browserscan.net
  Normal, `navigator.webdriver` false, real pixel ratio; downloads and the
  self-closing-popup download land on the HTTP driver.
- 2026-09-27, an outage made on purpose, the model's connection failing
  the way the person's did: two failures then recovery during the ending —
  both files checked and saved, report right, 32 s; the model gone for good
  during the ending — both files reported unchecked and left in place, the
  report written by code, 22 s; the model gone for the whole task — Jev
  alone asked the person at the sign-in once, downloaded, done in 2.9 s.
- 2026-09-25, bot-detection pages, headed on a scratch profile: after the
  launch changes, browserscan.net reports Normal on Webdriver, User-Agent,
  CDP and Navigator, and bot.sannysoft.com passes its WebDriver checks.
  Before them, both flagged the masked `navigator.webdriver` and the
  device pixel ratio of a fixed viewport on a Retina screen.
- 2026-09-25, the Jev driver, real Jev and a language model typing, on three
  synthetic portals, headless: documents page — chose the 2025 form over
  2024 and a statement, done in 1.5 s over 2 decisions; behind a sign-in —
  asked the person once, then the same, 2.8 s; a search box — the typing
  model wrote "tax form 2025", Jev clicked Search, then the 2025 download.
  Decisions took 108 to 212 ms and about a thousand tokens each.
- 2026-09-25, sign-in handoff, model-driven on a synthetic portal behind a
  login form: the model asked the person instead of typing a password,
  looked again after Continue, downloaded the 2025 form, opened it, saved it.
  Seven tool calls, one ask.
- 2026-09-25, `sky browser:task` headed against a public page: the window
  opened on Sky's profile, the heading came back, `report.md` was written.
- 2026-09-25, model-driven on a synthetic portal with a 2024 and a 2025
  form: chose 2025, checked the file with `read_file`, moved it with
  `save_file`, reported the path. Five tool calls.
- 2026-09-25, scripted, no model: server starts from Sky's Playwright, the
  snapshot carries refs, a click produces a download in `files/`,
  `navigator.webdriver` reads undefined, screenshots arrive as image parts.

## Notes

- 2026-09-25: the Jev driver behind the Experimental switch. See
  [2026-09-25-jev-picks-the-moves](2026-09-25-jev-picks-the-moves.md).
- 2026-09-25: first version — the command, the client, the runner. See
  [2026-09-25-sky-gets-a-general-purpose-browser](2026-09-25-sky-gets-a-general-purpose-browser.md).
